import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import Database, { type Database as DB, type Statement } from "better-sqlite3";
import { parse as parseCsv } from "csv-parse/sync";

export interface QueryOpts {
  where?: Record<string, string | number>;
  like?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export interface DatasetStat {
  rowCount: number;
  ingestedAt?: number;
}

interface MetaRow {
  dataset_id: string;
  table_name: string;
  row_count: number;
  ingested_at: number;
  labels_json: string;
  columns_json: string;
}

/** Sanitize a string into a SQL identifier. Always wrapped in quotes when used. */
function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  // SQLite identifiers can't start with a digit (when unquoted); we always
  // quote, but it's still cleaner to prefix.
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function tableNameFor(datasetId: string): string {
  return `dataset_${sanitizeIdent(datasetId)}`;
}

export class DatasetCache {
  private readonly db: DB;
  private readonly dbPath: string;

  constructor(cacheDir: string) {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
    this.dbPath = path.join(cacheDir, "sgdata.sqlite");
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        dataset_id   TEXT PRIMARY KEY,
        table_name   TEXT NOT NULL,
        row_count    INTEGER NOT NULL,
        ingested_at  INTEGER NOT NULL,
        labels_json  TEXT NOT NULL,
        columns_json TEXT NOT NULL
      );
    `);
  }

  /**
   * Parse a CSV body and write it into a per-dataset SQLite table.
   * Idempotent — drops + recreates the target table.
   */
  async ingest(
    datasetId: string,
    csv: Buffer,
    labels: Record<string, string>,
  ): Promise<{ rowCount: number }> {
    const records = parseCsv(csv, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];

    const table = tableNameFor(datasetId);
    const rawColumns: string[] = records.length > 0 ? Object.keys(records[0]!) : [];

    // Map raw csv header → sql column name. Prefer the human label, fall back
    // to the raw header. Disambiguate collisions by appending a suffix.
    const usedNames = new Set<string>();
    const colMapping: Array<{ raw: string; sql: string }> = [];
    for (const raw of rawColumns) {
      const labeled = labels[raw] ?? raw;
      let sql = sanitizeIdent(labeled);
      if (!sql) sql = "col";
      let candidate = sql;
      let i = 2;
      while (usedNames.has(candidate)) candidate = `${sql}_${i++}`;
      usedNames.add(candidate);
      colMapping.push({ raw, sql: candidate });
    }

    const dropAndCreate = this.db.transaction(() => {
      this.db.exec(`DROP TABLE IF EXISTS "${table}"`);
      if (colMapping.length === 0) {
        this.db.exec(`CREATE TABLE "${table}" (_empty INTEGER)`);
        return;
      }
      const colsDdl = colMapping.map((c) => `"${c.sql}" TEXT`).join(", ");
      this.db.exec(`CREATE TABLE "${table}" (${colsDdl})`);
    });
    dropAndCreate();

    let insertedRowCount = 0;
    if (colMapping.length > 0 && records.length > 0) {
      const colList = colMapping.map((c) => `"${c.sql}"`).join(", ");
      const placeholders = colMapping.map(() => "?").join(", ");
      const insert: Statement = this.db.prepare(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`,
      );
      const insertMany = this.db.transaction((rows: Record<string, string>[]) => {
        for (const row of rows) {
          const values = colMapping.map((c) => {
            const v = row[c.raw];
            return v === undefined || v === null ? null : String(v);
          });
          insert.run(...values);
          insertedRowCount++;
        }
      });
      insertMany(records);
    }

    const upsert = this.db.prepare(
      `INSERT INTO _meta (dataset_id, table_name, row_count, ingested_at, labels_json, columns_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(dataset_id) DO UPDATE SET
         table_name = excluded.table_name,
         row_count = excluded.row_count,
         ingested_at = excluded.ingested_at,
         labels_json = excluded.labels_json,
         columns_json = excluded.columns_json`,
    );
    upsert.run(
      datasetId,
      table,
      insertedRowCount,
      Date.now(),
      JSON.stringify(labels),
      JSON.stringify(colMapping),
    );

    return { rowCount: insertedRowCount };
  }

  query<T = Record<string, unknown>>(datasetId: string, opts: QueryOpts = {}): T[] {
    const meta = this.getMetaRow(datasetId);
    if (!meta) return [];
    const table = meta.table_name;
    const colMapping = JSON.parse(meta.columns_json) as Array<{
      raw: string;
      sql: string;
    }>;
    const validCols = new Set(colMapping.map((c) => c.sql));

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (opts.where) {
      for (const [k, v] of Object.entries(opts.where)) {
        const sql = sanitizeIdent(k);
        if (!validCols.has(sql)) continue;
        where.push(`"${sql}" = ?`);
        params.push(v);
      }
    }
    if (opts.like) {
      for (const [k, v] of Object.entries(opts.like)) {
        const sql = sanitizeIdent(k);
        if (!validCols.has(sql)) continue;
        where.push(`"${sql}" LIKE ?`);
        params.push(v);
      }
    }

    let sql = `SELECT * FROM "${table}"`;
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    if (opts.limit != null) sql += ` LIMIT ${Number(opts.limit) | 0}`;
    if (opts.offset != null) sql += ` OFFSET ${Number(opts.offset) | 0}`;

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  stat(datasetId: string): DatasetStat | null {
    const meta = this.getMetaRow(datasetId);
    if (!meta) return null;
    return { rowCount: meta.row_count, ingestedAt: meta.ingested_at };
  }

  isStale(datasetId: string, ttlMs: number): boolean {
    const meta = this.getMetaRow(datasetId);
    if (!meta) return true;
    return Date.now() - meta.ingested_at > ttlMs;
  }

  close(): void {
    this.db.close();
  }

  private getMetaRow(datasetId: string): MetaRow | undefined {
    const row = this.db
      .prepare(`SELECT * FROM _meta WHERE dataset_id = ?`)
      .get(datasetId);
    return (row as MetaRow | undefined) ?? undefined;
  }
}
