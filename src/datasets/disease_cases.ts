/**
 * Weekly Infectious Disease Bulletin Cases.
 *
 * Dataset: d_ca168b2cb763640d72c4600a68f9909e
 * Columns: epi_week, disease, no._of_cases
 * Covers dengue, HFMD, chickenpox, measles, TB, etc.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const diseaseCasesEntry: DatasetEntry = {
  id: "disease_cases",
  datasetId: "d_ca168b2cb763640d72c4600a68f9909e",
  shardCollection: false,
  name: "Weekly Infectious Disease Bulletin Cases",
  description:
    "MOH weekly infectious disease case counts — dengue, HFMD, " +
    "chickenpox, measles, tuberculosis, and more.",
  agency: "MOH",
  refreshDays: 7,
  tags: ["health", "disease", "dengue", "moh"],
};

type Row = Record<string, string | null>;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function createDiseaseCasesTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(diseaseCasesEntry);
    return cache.query<Row>(diseaseCasesEntry.datasetId, { limit: 500000 });
  }

  return [
    {
      name: "sg_disease_latest",
      description:
        "Get the most recent week's infectious disease case counts. " +
        "Optionally filter by disease name (substring match, e.g. " +
        "'Dengue', 'HFMD', 'Tuberculosis').",
      inputSchema: z.object({
        disease: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ disease: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        // Find the latest epi_week
        const weeks = [...new Set(rows.map((r) => r.epi_week ?? ""))].sort();
        const latestWeek = weeks[weeks.length - 1];
        let latest = rows.filter((r) => r.epi_week === latestWeek);
        if (p.disease) {
          latest = latest.filter((r) =>
            (r.disease ?? "").toLowerCase().includes(p.disease!.toLowerCase()),
          );
        }
        return {
          datasetId: diseaseCasesEntry.datasetId,
          epi_week: latestWeek,
          count: latest.length,
          cases: latest.map((r) => ({
            disease: r.disease,
            cases: toNum(r.no__of_cases) ?? toNum(r["no._of_cases"]),
          })),
        };
      },
    },
    {
      name: "sg_disease_trend",
      description:
        "Weekly case count trend for a specific disease (e.g. 'Dengue " +
        "Fever', 'HFMD'). Returns oldest-to-newest, optionally trimmed " +
        "to last N weeks.",
      inputSchema: z.object({
        disease: z.string(),
        weeks_back: z.number().int().positive().max(520).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            disease: z.string(),
            weeks_back: z.number().int().positive().max(520).optional(),
          })
          .parse(input);
        const rows = (await fetchAll())
          .filter((r) =>
            (r.disease ?? "").toLowerCase().includes(p.disease.toLowerCase()),
          )
          .sort((a, b) =>
            ((a.epi_week as string) ?? "").localeCompare(
              (b.epi_week as string) ?? "",
            ),
          );
        const trimmed = p.weeks_back ? rows.slice(-p.weeks_back) : rows;
        return {
          datasetId: diseaseCasesEntry.datasetId,
          disease: p.disease,
          count: trimmed.length,
          series: trimmed.map((r) => ({
            epi_week: r.epi_week,
            cases: toNum(r.no__of_cases) ?? toNum(r["no._of_cases"]),
          })),
        };
      },
    },
    {
      name: "sg_disease_list",
      description:
        "List all diseases tracked in the Weekly Infectious Disease " +
        "Bulletin with their total case counts across all weeks.",
      inputSchema: z.object({}),
      handler: async () => {
        const rows = await fetchAll();
        const totals = new Map<string, number>();
        for (const r of rows) {
          const d = (r.disease ?? "").trim();
          if (!d) continue;
          const c = toNum(r.no__of_cases) ?? toNum(r["no._of_cases"]) ?? 0;
          totals.set(d, (totals.get(d) ?? 0) + c);
        }
        const sorted = [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([disease, total]) => ({ disease, total_cases: total }));
        return {
          datasetId: diseaseCasesEntry.datasetId,
          count: sorted.length,
          diseases: sorted,
        };
      },
    },
  ];
}
