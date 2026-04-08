/**
 * ECDA Listing of Childcare & Kindergarten Centres.
 *
 * Dataset: d_696c994c50745b079b3684f0e90ffc53 — ~2,300 centres.
 * Columns: centre_code, centre_name, organisation_description, service_model,
 * centre_contact_no, centre_email_address, centre_address, postal_code,
 * centre_website, infant_vacancy_current_month, infant_vacancy_next_month,
 * pg_vacancy_current_month, n1_vacancy_current_month, n2_vacancy_current_month,
 * k1_vacancy_current_month, k2_vacancy_current_month, spark_certified.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const ecdaChildcareEntry: DatasetEntry = {
  id: "ecda_childcare",
  datasetId: "d_696c994c50745b079b3684f0e90ffc53",
  shardCollection: false,
  name: "ECDA Childcare & Kindergarten Centres",
  description:
    "ECDA listing of licensed childcare and kindergarten centres in " +
    "Singapore, with current and next-month vacancy counts by level.",
  agency: "ECDA",
  refreshDays: 1,
  tags: ["education", "childcare", "preschool", "ecda"],
};

type Row = Record<string, string | null>;

const VACANCY_COLUMNS: Record<string, string> = {
  infant: "infant_vacancy_current_month",
  pg: "pg_vacancy_current_month",
  n1: "n1_vacancy_current_month",
  n2: "n2_vacancy_current_month",
  k1: "k1_vacancy_current_month",
  k2: "k2_vacancy_current_month",
};

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function isYes(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === "YES" || s === "Y" || s === "TRUE" || s === "1";
}

export function createEcdaChildcareTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const searchInput = z.object({
    query: z.string().optional(),
    postal_prefix: z.string().optional(),
    service_model: z.string().optional(),
    has_infant_vacancy: z.boolean().optional(),
    spark_certified: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  });

  const nearInput = z.object({
    postal_code: z.string().min(2),
    prefix_length: z.number().int().min(1).max(6).optional(),
  });

  const vacancyInput = z.object({
    level: z.enum(["infant", "pg", "n1", "n2", "k1", "k2"]),
    postal_prefix: z.string().optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(ecdaChildcareEntry);
    return cache.query<Row>(ecdaChildcareEntry.datasetId, { limit: 10000 });
  }

  return [
    {
      name: "sg_ecda_search_centres",
      description:
        "Search ECDA childcare & kindergarten centres. Filters: name " +
        "substring, postal_code prefix, service_model ('Childcare', " +
        "'Kindergarten', etc.), has_infant_vacancy (true = at least one " +
        "infant slot), spark_certified.",
      inputSchema: searchInput,
      handler: async (input: unknown) => {
        const p = searchInput.parse(input);
        const limit = p.limit ?? 50;
        const offset = p.offset ?? 0;
        const all = await fetchAll();
        const q = p.query?.toLowerCase();
        const svc = p.service_model?.toLowerCase();
        const filtered = all.filter((r) => {
          if (
            q &&
            !((r.centre_name as string | null) ?? "")
              .toLowerCase()
              .includes(q) &&
            !((r.organisation_description as string | null) ?? "")
              .toLowerCase()
              .includes(q)
          ) {
            return false;
          }
          if (
            p.postal_prefix &&
            !((r.postal_code as string | null) ?? "").startsWith(p.postal_prefix)
          ) {
            return false;
          }
          if (
            svc &&
            !((r.service_model as string | null) ?? "")
              .toLowerCase()
              .includes(svc)
          ) {
            return false;
          }
          if (p.has_infant_vacancy != null) {
            const v = toNumber(r.infant_vacancy_current_month) ?? 0;
            const ok = v > 0;
            if (ok !== p.has_infant_vacancy) return false;
          }
          if (p.spark_certified != null) {
            if (isYes(r.spark_certified) !== p.spark_certified) return false;
          }
          return true;
        });
        return {
          datasetId: ecdaChildcareEntry.datasetId,
          total: filtered.length,
          returned: Math.min(limit, Math.max(0, filtered.length - offset)),
          offset,
          limit,
          rows: filtered.slice(offset, offset + limit),
        };
      },
    },
    {
      name: "sg_ecda_centres_near",
      description:
        "Find childcare centres whose postal_code shares a prefix with " +
        "the supplied postal_code (default prefix length 2 — postal sector).",
      inputSchema: nearInput,
      handler: async (input: unknown) => {
        const p = nearInput.parse(input);
        const prefixLen = p.prefix_length ?? 2;
        const prefix = p.postal_code.slice(0, prefixLen);
        const all = await fetchAll();
        const matches = all.filter((r) =>
          ((r.postal_code as string | null) ?? "").startsWith(prefix),
        );
        return {
          datasetId: ecdaChildcareEntry.datasetId,
          postal_code: p.postal_code,
          prefix,
          count: matches.length,
          rows: matches,
        };
      },
    },
    {
      name: "sg_ecda_vacancy_summary",
      description:
        "Aggregate vacancy count for a given level (infant/pg/n1/n2/k1/k2), " +
        "optionally restricted to a postal_code prefix. Returns total " +
        "vacancies, centres with vacancy, and centres reviewed.",
      inputSchema: vacancyInput,
      handler: async (input: unknown) => {
        const p = vacancyInput.parse(input);
        const column = VACANCY_COLUMNS[p.level]!;
        const all = await fetchAll();
        const scope = p.postal_prefix
          ? all.filter((r) =>
              ((r.postal_code as string | null) ?? "").startsWith(
                p.postal_prefix!,
              ),
            )
          : all;
        let total = 0;
        let centresWithVacancy = 0;
        for (const r of scope) {
          const v = toNumber(r[column]) ?? 0;
          total += v;
          if (v > 0) centresWithVacancy += 1;
        }
        return {
          datasetId: ecdaChildcareEntry.datasetId,
          level: p.level,
          postal_prefix: p.postal_prefix ?? null,
          centres_reviewed: scope.length,
          centres_with_vacancy: centresWithVacancy,
          total_vacancies: total,
        };
      },
    },
  ];
}
