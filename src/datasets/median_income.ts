/**
 * Median Gross Monthly Income From Employment by Sex.
 *
 * Dataset: d_aa75b9227b47cbc12ffe0e3be4979546 — ~120 rows.
 * Columns: year, sex, median_income_incl_emp_cpf, median_income_excl_emp_cpf.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

export const medianIncomeEntry: DatasetEntry = {
  id: "median_income",
  datasetId: "d_aa75b9227b47cbc12ffe0e3be4979546",
  shardCollection: false,
  name: "Median Gross Monthly Income by Sex",
  description:
    "MOM annual median gross monthly income from employment, broken down " +
    "by sex and by inclusion/exclusion of employer CPF.",
  agency: "MOM",
  refreshDays: 90,
  tags: ["labour", "income", "mom", "wages"],
};

type Row = Record<string, string | null>;

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function createMedianIncomeTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  const latestInput = z.object({
    year: z.number().int().optional(),
    sex: z.string().optional(),
  });

  const historyInput = z.object({
    sex: z.string().optional(),
    years_back: z.number().int().positive().max(50).optional(),
  });

  async function fetchAll(): Promise<Row[]> {
    await downloader.ensureFresh(medianIncomeEntry);
    return cache.query<Row>(medianIncomeEntry.datasetId, { limit: 5000 });
  }

  return [
    {
      name: "sg_median_income_lookup",
      description:
        "Look up median monthly income by year and/or sex. If year is " +
        "omitted, returns the most recent year. sex values: 'Males', " +
        "'Females', 'Total'.",
      inputSchema: latestInput,
      handler: async (input: unknown) => {
        const p = latestInput.parse(input);
        const rows = await fetchAll();
        const filtered = rows.filter((r) => {
          if (p.year != null && toNumber(r.year) !== p.year) return false;
          if (
            p.sex &&
            ((r.sex as string | null) ?? "").toLowerCase() !== p.sex.toLowerCase()
          ) {
            return false;
          }
          return true;
        });

        // If no year specified, return only the latest year's rows
        if (p.year == null && filtered.length > 0) {
          const maxYear = Math.max(
            ...filtered
              .map((r) => toNumber(r.year))
              .filter((n): n is number => n != null),
          );
          return {
            datasetId: medianIncomeEntry.datasetId,
            year: maxYear,
            rows: filtered.filter((r) => toNumber(r.year) === maxYear),
          };
        }
        return {
          datasetId: medianIncomeEntry.datasetId,
          rows: filtered,
        };
      },
    },
    {
      name: "sg_median_income_history",
      description:
        "Annual median income time series for a given sex ('Males', " +
        "'Females', or 'Total'). Returns oldest-to-newest, trimmed to " +
        "last N years if years_back is given.",
      inputSchema: historyInput,
      handler: async (input: unknown) => {
        const p = historyInput.parse(input);
        const rows = await fetchAll();
        const sexFilter = p.sex?.toLowerCase();
        const filtered = rows
          .filter(
            (r) =>
              !sexFilter ||
              ((r.sex as string | null) ?? "").toLowerCase() === sexFilter,
          )
          .sort((a, b) => (toNumber(a.year) ?? 0) - (toNumber(b.year) ?? 0));
        const trimmed = p.years_back
          ? filtered.slice(-p.years_back * 3)
          : filtered;
        return {
          datasetId: medianIncomeEntry.datasetId,
          sex: p.sex ?? "all",
          count: trimmed.length,
          rows: trimmed,
        };
      },
    },
  ];
}
