/**
 * Annual Tourism Receipts by Major Components.
 *
 * Dataset: d_e285a651ec353416054195528ca988a9
 * Columns: period, components, tot_tr (total tourism receipts $M),
 * trpce (tourism receipts per capita expenditure).
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const tourismReceiptsEntry: DatasetEntry = {
  id: "tourism_receipts",
  datasetId: "d_e285a651ec353416054195528ca988a9",
  shardCollection: false,
  name: "Annual Tourism Receipts",
  description:
    "STB annual tourism receipts by major component (shopping, " +
    "accommodation, F&B, transport, etc.) in S$ millions.",
  agency: "STB",
  refreshDays: 90,
  tags: ["tourism", "economy", "stb"],
};

type Row = Record<string, string | null>;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function createTourismReceiptsTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(tourismReceiptsEntry);
    return cache.query<Row>(tourismReceiptsEntry.datasetId, { limit: 100000 });
  }

  return [
    {
      name: "sg_tourism_latest",
      description:
        "Get the most recent year's tourism receipts breakdown by " +
        "component (shopping, accommodation, F&B, transport, etc.).",
      inputSchema: z.object({}),
      handler: async () => {
        const rows = await fetchAll();
        rows.sort((a, b) =>
          ((b.period as string) ?? "").localeCompare((a.period as string) ?? ""),
        );
        const latestPeriod = rows[0]?.period;
        const latest = rows.filter((r) => r.period === latestPeriod);
        return {
          datasetId: tourismReceiptsEntry.datasetId,
          period: latestPeriod,
          count: latest.length,
          components: latest.map((r) => ({
            component: r.components,
            total_receipts_million: toNum(r.tot_tr),
            per_capita_expenditure: toNum(r.trpce),
          })),
        };
      },
    },
    {
      name: "sg_tourism_history",
      description:
        "Tourism receipts time series for a specific component " +
        "(e.g. 'Shopping', 'Accommodation', 'Food & Beverage'). " +
        "Returns annual data oldest-to-newest.",
      inputSchema: z.object({
        component: z.string(),
        years_back: z.number().int().positive().max(50).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            component: z.string(),
            years_back: z.number().int().positive().max(50).optional(),
          })
          .parse(input);
        const rows = (await fetchAll())
          .filter((r) =>
            (r.components ?? "")
              .toLowerCase()
              .includes(p.component.toLowerCase()),
          )
          .sort((a, b) =>
            ((a.period as string) ?? "").localeCompare((b.period as string) ?? ""),
          );
        const trimmed = p.years_back ? rows.slice(-p.years_back) : rows;
        return {
          datasetId: tourismReceiptsEntry.datasetId,
          component: p.component,
          count: trimmed.length,
          series: trimmed.map((r) => ({
            period: r.period,
            total_receipts_million: toNum(r.tot_tr),
            per_capita_expenditure: toNum(r.trpce),
          })),
        };
      },
    },
  ];
}
