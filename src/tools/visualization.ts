/**
 * Data visualization tools — ASCII sparklines + chart-ready JSON.
 *
 * Provides sg_visualize tool that takes any numeric time-series and
 * returns an ASCII sparkline, summary stats, and chart-ready JSON
 * (suitable for rendering in any charting library).
 */

import { z } from "zod";
import type { ToolDef } from "./index.js";

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Generate an ASCII sparkline string from numeric values.
 * Each value maps to a bar character based on its position in the range.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[idx];
    })
    .join("");
}

/** Compute basic summary stats. */
function stats(values: number[]): {
  min: number;
  max: number;
  mean: number;
  latest: number;
  change: number | null;
  change_pct: number | null;
} {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1]!;
  const prev = values.length > 1 ? values[values.length - 2]! : null;
  const change = prev != null ? latest - prev : null;
  const change_pct =
    prev != null && prev !== 0 ? ((latest - prev) / Math.abs(prev)) * 100 : null;
  return {
    min: round(min),
    max: round(max),
    mean: round(mean),
    latest: round(latest),
    change: change != null ? round(change) : null,
    change_pct: change_pct != null ? round(change_pct) : null,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

const VisualizeInput = z.object({
  title: z.string().optional(),
  labels: z.array(z.string()),
  values: z.array(z.number()),
  unit: z.string().optional(),
});

export function createVisualizationTools(): ToolDef[] {
  return [
    {
      name: "sg_visualize",
      description:
        "Generate an ASCII sparkline chart and summary statistics from " +
        "a numeric time series. Pass labels (e.g. dates) and corresponding " +
        "values. Returns sparkline, min/max/mean/latest, period-over-period " +
        "change, and chart-ready JSON for frontend rendering.",
      inputSchema: VisualizeInput,
      handler: async (input: unknown) => {
        const p = VisualizeInput.parse(input);
        const vals = p.values;
        if (vals.length === 0) {
          return { error: "No values provided." };
        }
        const spark = sparkline(vals);
        const s = stats(vals);
        return {
          title: p.title ?? "Time Series",
          unit: p.unit ?? "",
          sparkline: spark,
          stats: s,
          chart_data: {
            type: "line",
            labels: p.labels,
            datasets: [
              {
                label: p.title ?? "Value",
                data: vals,
              },
            ],
          },
          // Quick text summary
          summary: `${p.title ?? "Series"}: ${spark}\n` +
            `Latest: ${s.latest}${p.unit ? " " + p.unit : ""} | ` +
            `Change: ${s.change != null ? (s.change >= 0 ? "+" : "") + s.change : "N/A"} ` +
            `(${s.change_pct != null ? (s.change_pct >= 0 ? "+" : "") + s.change_pct + "%" : "N/A"}) | ` +
            `Range: ${s.min}–${s.max} | Mean: ${s.mean}`,
        };
      },
    },
  ];
}
