/**
 * Overall Unemployment Rate, Quarterly.
 *
 * Dataset: d_ca32584c91ee07d091a4ce75fa868414
 * Columns: period (YYYY-QN), residential_status, seasonally_adj_unemp_rate,
 * non_seasonally_adj_unemp_rate.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const unemploymentEntry: DatasetEntry = {
  id: "unemployment",
  datasetId: "d_ca32584c91ee07d091a4ce75fa868414",
  shardCollection: false,
  name: "Overall Unemployment Rate, Quarterly",
  description:
    "MOM quarterly unemployment rates by residential status (overall, " +
    "residents, citizens). Both seasonally adjusted and unadjusted.",
  agency: "MOM",
  refreshDays: 30,
  tags: ["labour", "unemployment", "mom", "macro"],
};

type Row = Record<string, string | null>;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function createUnemploymentTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(unemploymentEntry);
    return cache.query<Row>(unemploymentEntry.datasetId, { limit: 100000 });
  }

  return [
    {
      name: "sg_unemployment_latest",
      description:
        "Get the most recent quarterly unemployment rates for Singapore. " +
        "Returns seasonally adjusted and unadjusted rates by residential " +
        "status (overall, residents, citizens).",
      inputSchema: z.object({
        residential_status: z.string().optional(),
      }),
      handler: async (input: unknown) => {
        const p = z.object({ residential_status: z.string().optional() }).parse(input);
        const rows = await fetchAll();
        const filtered = p.residential_status
          ? rows.filter((r) =>
              (r.residential_status ?? "")
                .toLowerCase()
                .includes(p.residential_status!.toLowerCase()),
            )
          : rows;
        // Sort by period desc to get latest
        filtered.sort((a, b) =>
          ((b.period as string) ?? "").localeCompare((a.period as string) ?? ""),
        );
        // Get all rows from the latest period
        const latestPeriod = filtered[0]?.period;
        const latest = filtered.filter((r) => r.period === latestPeriod);
        return {
          datasetId: unemploymentEntry.datasetId,
          latest_period: latestPeriod,
          count: latest.length,
          rates: latest.map((r) => ({
            period: r.period,
            residential_status: r.residential_status,
            seasonally_adjusted: toNum(r.seasonally_adj_unemp_rate),
            unadjusted: toNum(r.non_seasonally_adj_unemp_rate),
          })),
        };
      },
    },
    {
      name: "sg_unemployment_history",
      description:
        "Unemployment rate time series for a given residential status " +
        "(e.g. 'Overall', 'Residents', 'Citizens'). Returns quarterly " +
        "data oldest-to-newest, optionally trimmed to last N quarters.",
      inputSchema: z.object({
        residential_status: z.string(),
        quarters_back: z.number().int().positive().max(200).optional(),
      }),
      handler: async (input: unknown) => {
        const p = z
          .object({
            residential_status: z.string(),
            quarters_back: z.number().int().positive().max(200).optional(),
          })
          .parse(input);
        const rows = (await fetchAll())
          .filter((r) =>
            (r.residential_status ?? "")
              .toLowerCase()
              .includes(p.residential_status.toLowerCase()),
          )
          .sort((a, b) =>
            ((a.period as string) ?? "").localeCompare((b.period as string) ?? ""),
          );
        const trimmed = p.quarters_back ? rows.slice(-p.quarters_back) : rows;
        return {
          datasetId: unemploymentEntry.datasetId,
          residential_status: p.residential_status,
          count: trimmed.length,
          series: trimmed.map((r) => ({
            period: r.period,
            seasonally_adjusted: toNum(r.seasonally_adj_unemp_rate),
            unadjusted: toNum(r.non_seasonally_adj_unemp_rate),
          })),
        };
      },
    },
  ];
}
