/**
 * Freshness metadata helpers — emitted on every "_latest" tool response so
 * agents and CLI users can tell when an upstream data.gov.sg dataset has
 * stopped updating.
 *
 * Background: MOH's Weekly Infectious Disease Bulletin dataset
 * (d_ca168b2cb763640d72c4600a68f9909e) went silent at epi_week 2022-W52
 * and our `sg_disease_latest` quietly served stale data for 3+ years
 * without warning. v0.4.0 fixes that by attaching a `data_freshness`
 * block to every latest-style response.
 */

export type FreshnessLevel = "fresh" | "ok" | "stale" | "frozen";

export interface DataFreshness {
  /** Raw period string from the dataset (epi week, month, quarter, year). */
  last_period: string;
  /** Parsed ISO date of the latest observation. */
  last_record_date: string;
  /** Days between the latest observation and today. */
  age_days: number;
  /** Categorical bucket — `frozen` means the upstream feed has stopped updating. */
  level: FreshnessLevel;
  /** Human-readable explanation, null when fresh. */
  warning: string | null;
}

export type PeriodKind = "weekly" | "monthly" | "quarterly" | "annual";

/**
 * Map ISO-week (`YYYY-Www` or `YYYY-W##`) to the Monday of that week.
 * Uses ISO 8601 week numbering: week 1 contains 4 Jan.
 */
function isoWeekToDate(year: number, week: number): Date {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = new Date(jan4).getUTCDay() || 7;
  const week1Monday = jan4 - (jan4Dow - 1) * 86400000;
  return new Date(week1Monday + (week - 1) * 7 * 86400000);
}

/**
 * Parse a period string emitted by data.gov.sg into the END-of-period ISO
 * date. We use end-of-period because that's the earliest moment the value
 * could have been published.
 *
 * Accepted shapes:
 *   - `2026-W17`, `2026W17`            (ISO week)
 *   - `2026-05`, `2026-May`, `2026M05` (month)
 *   - `2025-Q4`, `2025Q4`              (quarter)
 *   - `2025`                           (year)
 */
export function parsePeriodToDate(period: string): { date: Date; kind: PeriodKind } | null {
  if (!period) return null;
  const s = period.trim();

  // ISO week — 2026-W17 or 2026W17
  const wk = s.match(/^(\d{4})-?W(\d{1,2})$/i);
  if (wk) {
    const monday = isoWeekToDate(Number(wk[1]), Number(wk[2]));
    // Use Sunday (end of ISO week) as the "as-of" date.
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return { date: sunday, kind: "weekly" };
  }

  // Quarter — 2025-Q4 or 2025Q4
  const qm = s.match(/^(\d{4})-?Q([1-4])$/i);
  if (qm) {
    const year = Number(qm[1]);
    const q = Number(qm[2]);
    // Quarter end month: Q1=Mar, Q2=Jun, Q3=Sep, Q4=Dec
    const endMonth = q * 3 - 1;
    const endDay = [31, 30, 30, 31][q - 1];
    return { date: new Date(Date.UTC(year, endMonth, endDay)), kind: "quarterly" };
  }

  // Month — 2026-05, 2026M05, 2026-May
  const monthNames: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mm = s.match(/^(\d{4})[-M]?(\d{1,2}|[A-Za-z]{3,9})$/);
  if (mm) {
    const year = Number(mm[1]);
    let monthIdx: number;
    if (/^\d+$/.test(mm[2])) {
      monthIdx = Number(mm[2]) - 1;
    } else {
      const lookup = monthNames[mm[2].slice(0, 3).toLowerCase()];
      if (lookup === undefined) return null;
      monthIdx = lookup;
    }
    if (monthIdx < 0 || monthIdx > 11) return null;
    // End-of-month
    const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    return { date: new Date(Date.UTC(year, monthIdx, lastDay)), kind: "monthly" };
  }

  // Annual — 2025
  const ym = s.match(/^(\d{4})$/);
  if (ym) {
    return { date: new Date(Date.UTC(Number(ym[1]), 11, 31)), kind: "annual" };
  }

  return null;
}

/**
 * Cadence-aware staleness thresholds. Weekly data more than ~3 weeks late
 * is suspect; quarterly data has a wider tolerance because publishers
 * legitimately run a month or two behind.
 */
const STALE_DAYS: Record<PeriodKind, number> = {
  weekly: 21,
  monthly: 60,
  quarterly: 150,
  annual: 540,
};

const FROZEN_DAYS: Record<PeriodKind, number> = {
  weekly: 180,
  monthly: 365,
  quarterly: 540,
  annual: 1095,
};

/**
 * Build the `data_freshness` block for a given period string. Returns null
 * if we can't parse the period (so callers can decide whether to omit the
 * field or fall back to a raw warning).
 */
export function buildFreshness(
  period: string,
  opts: { now?: Date; kindHint?: PeriodKind } = {},
): DataFreshness | null {
  const parsed = parsePeriodToDate(period);
  if (!parsed) return null;
  const kind = opts.kindHint ?? parsed.kind;
  const now = opts.now ?? new Date();
  const ageMs = now.getTime() - parsed.date.getTime();
  const ageDays = Math.max(0, Math.round(ageMs / 86400000));

  let level: FreshnessLevel = "fresh";
  let warning: string | null = null;
  if (ageDays >= FROZEN_DAYS[kind]) {
    level = "frozen";
    warning = `Upstream dataset appears frozen — latest record is ${period} (${ageDays} days old). The data.gov.sg feed may have been deprecated by the publishing agency. Cross-check the agency's primary website before relying on this.`;
  } else if (ageDays >= STALE_DAYS[kind]) {
    level = "stale";
    warning = `Data is older than the typical ${kind} refresh cadence (latest record: ${period}, ${ageDays} days old). The publishing agency may be running behind schedule.`;
  } else if (ageDays >= STALE_DAYS[kind] / 2) {
    level = "ok";
  }

  return {
    last_period: period,
    last_record_date: parsed.date.toISOString().slice(0, 10),
    age_days: ageDays,
    level,
    warning,
  };
}
