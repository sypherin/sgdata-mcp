/**
 * Real-time data layer for sgdata-mcp.
 *
 * These tools hit data.gov.sg's REAL-TIME API (`https://api.data.gov.sg/v1/*`),
 * a separate service from the dataset-download API (`api-production.data.gov.sg/v2`)
 * the rest of the server uses. Each handler fetches LIVE data on every call —
 * nothing is cached locally, because these readings change minute-to-minute.
 *
 * Endpoints (verified live 2026-06-04):
 *   - /v1/environment/psi
 *   - /v1/environment/air-temperature
 *   - /v1/environment/rainfall
 *   - /v1/environment/2-hour-weather-forecast
 *   - /v1/environment/24-hour-weather-forecast
 *   - /v1/transport/carpark-availability
 *
 * Dengue clusters: the realtime endpoint /v1/environment/dengue-clusters
 * returns HTTP 403 (decommissioned). The live source is now NEA's
 * "Dengue Clusters (GEOJSON)" dataset on the v2 download API
 * (d_dbfabf16158d1b0e1c420627c0819168), which we pull via the shared
 * download helpers.
 *
 * The factory signature matches every other create*Tools factory in
 * src/datasets/ (cache + downloader injected). The realtime tools don't use
 * the SQLite cache, but accept the args to stay drop-in compatible with how
 * src/tools wires the dataset factories.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader } from "../core/index.js";
import { waitForDownloadUrl } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

const RT_BASE = "https://api.data.gov.sg/v1";

/** GeoJSON dataset id for NEA's live "Dengue Clusters (GEOJSON)". */
const DENGUE_GEOJSON_DATASET = "d_dbfabf16158d1b0e1c420627c0819168";

type Json = Record<string, any>;

/** Fetch + parse a realtime endpoint, throwing on non-2xx. */
async function fetchRt(path: string): Promise<Json> {
  const url = `${RT_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "sgdata-mcp" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${path}`);
  }
  return (await res.json()) as Json;
}

/** Wrap a handler so any thrown error becomes `{ error }` instead of crashing. */
function safe(
  fn: () => Promise<unknown>,
  context: string,
): Promise<unknown> {
  return fn().catch((e: unknown) => ({
    error: `${context}: ${e instanceof Error ? e.message : String(e)}`,
  }));
}

const REGIONS = ["north", "south", "east", "west", "central"] as const;

function summariseNumbers(values: number[]): {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
} {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return { count: 0, min: null, max: null, avg: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: Math.round((sum / nums.length) * 100) / 100,
  };
}

export function createRealtimeTools(
  _cache: DatasetCache,
  _downloader: DatasetDownloader,
): ToolDef[] {
  return [
    // ----------------------------------------------------------------- PSI
    {
      name: "sg_psi",
      description:
        "Live NEA Pollutant Standards Index (PSI) for Singapore. Returns the " +
        "national headline 24-hour PSI (the highest regional reading, per NEA " +
        "convention) plus a per-region breakdown (north/south/east/west/central) " +
        "of 24-hour PSI and 24-hour PM2.5 concentration. Updated hourly.",
      inputSchema: z.object({}),
      handler: (input: unknown) =>
        safe(async () => {
          const data = await fetchRt("/environment/psi");
          const item = data.items?.[0];
          if (!item) return { error: "no PSI readings returned" };
          const r = item.readings ?? {};
          const psi24: Record<string, number> = r.psi_twenty_four_hourly ?? {};
          const pm25: Record<string, number> = r.pm25_twenty_four_hourly ?? {};

          const regions = REGIONS.map((name) => ({
            region: name,
            psi_24h: psi24[name] ?? null,
            pm25_24h: pm25[name] ?? null,
          }));

          const psiValues = REGIONS.map((n) => psi24[n]).filter(
            (v): v is number => typeof v === "number",
          );
          const nationalPsi = psiValues.length ? Math.max(...psiValues) : null;

          return {
            source: "data.gov.sg /v1/environment/psi (NEA)",
            timestamp: item.timestamp,
            updated: item.update_timestamp,
            national: {
              psi_24h: nationalPsi,
              descriptor: psiBand(nationalPsi),
              note: "National PSI = highest 24h regional reading (NEA headline convention).",
            },
            regions,
          };
        }, "sg_psi failed"),
    },

    // ------------------------------------------------------- air temperature
    {
      name: "sg_air_temperature",
      description:
        "Live air temperature readings (deg C) from NEA weather stations across " +
        "Singapore, with each station's name, coordinates and current value, plus " +
        "an island-wide min/max/avg summary. Updated roughly every minute.",
      inputSchema: z.object({}),
      handler: (input: unknown) =>
        safe(async () => {
          const data = await fetchRt("/environment/air-temperature");
          const stations: Json[] = data.metadata?.stations ?? [];
          const item = data.items?.[0];
          const readings: Json[] = item?.readings ?? [];
          const byId = new Map(
            stations.map((s) => [s.id ?? s.device_id, s]),
          );

          const rows = readings.map((rd) => {
            const st = byId.get(rd.station_id);
            return {
              station_id: rd.station_id,
              name: st?.name ?? null,
              value_c: rd.value,
              location: st?.location ?? null,
            };
          });

          return {
            source: "data.gov.sg /v1/environment/air-temperature (NEA)",
            timestamp: item?.timestamp ?? null,
            unit: data.metadata?.reading_unit ?? "deg C",
            station_count: rows.length,
            summary_c: summariseNumbers(rows.map((r) => Number(r.value_c))),
            readings: rows,
          };
        }, "sg_air_temperature failed"),
    },

    // -------------------------------------------------------------- rainfall
    {
      name: "sg_rainfall",
      description:
        "Live 5-minute rainfall readings (mm) from NEA stations across Singapore. " +
        "Returns every station's current reading plus the subset of stations that " +
        "are actually reporting rain (value > 0). Updated every ~5 minutes.",
      inputSchema: z.object({}),
      handler: (input: unknown) =>
        safe(async () => {
          const data = await fetchRt("/environment/rainfall");
          const stations: Json[] = data.metadata?.stations ?? [];
          const item = data.items?.[0];
          const readings: Json[] = item?.readings ?? [];
          const byId = new Map(
            stations.map((s) => [s.id ?? s.device_id, s]),
          );

          const rows = readings.map((rd) => {
            const st = byId.get(rd.station_id);
            return {
              station_id: rd.station_id,
              name: st?.name ?? null,
              value_mm: rd.value,
              location: st?.location ?? null,
            };
          });

          const raining = rows
            .filter((r) => Number(r.value_mm) > 0)
            .sort((a, b) => Number(b.value_mm) - Number(a.value_mm));

          return {
            source: "data.gov.sg /v1/environment/rainfall (NEA)",
            timestamp: item?.timestamp ?? null,
            unit: data.metadata?.reading_unit ?? "mm",
            station_count: rows.length,
            stations_reporting_rain: raining.length,
            raining,
            all_readings: rows,
          };
        }, "sg_rainfall failed"),
    },

    // ------------------------------------------------------ weather forecast
    {
      name: "sg_weather_forecast",
      description:
        "NEA weather forecast for Singapore. By default returns the 2-hour " +
        "nowcast per area (47 named areas, e.g. 'Ang Mo Kio', 'Bedok'). Pass " +
        "horizon='24h' for the 24-hour outlook (general day/night summary, " +
        "temperature & humidity ranges, wind, and per-region time-block forecasts). " +
        "Optional `area` substring filter applies to the 2-hour forecast.",
      inputSchema: z.object({
        horizon: z.enum(["2h", "24h"]).optional(),
        area: z.string().optional(),
      }),
      handler: (input: unknown) =>
        safe(async () => {
          const p = z
            .object({
              horizon: z.enum(["2h", "24h"]).optional(),
              area: z.string().optional(),
            })
            .parse(input);

          if (p.horizon === "24h") {
            const data = await fetchRt("/environment/24-hour-weather-forecast");
            const item = data.items?.[0];
            if (!item) return { error: "no 24h forecast returned" };
            return {
              source:
                "data.gov.sg /v1/environment/24-hour-weather-forecast (NEA)",
              updated: item.update_timestamp,
              valid_period: item.valid_period,
              general: item.general,
              periods: item.periods,
            };
          }

          const data = await fetchRt("/environment/2-hour-weather-forecast");
          const item = data.items?.[0];
          if (!item) return { error: "no 2h forecast returned" };
          let forecasts: Json[] = item.forecasts ?? [];
          if (p.area) {
            const needle = p.area.toLowerCase();
            forecasts = forecasts.filter((f) =>
              String(f.area ?? "").toLowerCase().includes(needle),
            );
          }
          return {
            source:
              "data.gov.sg /v1/environment/2-hour-weather-forecast (NEA)",
            timestamp: item.timestamp,
            updated: item.update_timestamp,
            valid_period: item.valid_period,
            area_count: forecasts.length,
            forecasts,
          };
        }, "sg_weather_forecast failed"),
    },

    // -------------------------------------------------- carpark availability
    {
      name: "sg_carpark_availability",
      description:
        "Live HDB/LTA carpark lot availability across Singapore (updated every " +
        "minute). Returns each carpark's number, available vs total lots, lot type, " +
        "and update time. Use `carpark_number` for a substring match on the carpark " +
        "id (e.g. 'HE12', 'BM'), and `limit` to cap the number of carparks returned " +
        "(default 50). Without filters the list is large (~1900 carparks).",
      inputSchema: z.object({
        carpark_number: z.string().optional(),
        limit: z.number().int().positive().max(2000).optional(),
      }),
      handler: (input: unknown) =>
        safe(async () => {
          const p = z
            .object({
              carpark_number: z.string().optional(),
              limit: z.number().int().positive().max(2000).optional(),
            })
            .parse(input);

          const data = await fetchRt("/transport/carpark-availability");
          const item = data.items?.[0];
          const all: Json[] = item?.carpark_data ?? [];

          let rows = all.map((c) => ({
            carpark_number: c.carpark_number,
            update_datetime: c.update_datetime,
            lots: (c.carpark_info ?? []).map((i: Json) => ({
              lot_type: i.lot_type,
              lots_available: Number(i.lots_available),
              total_lots: Number(i.total_lots),
            })),
          }));

          if (p.carpark_number) {
            const needle = p.carpark_number.toLowerCase();
            rows = rows.filter((r) =>
              String(r.carpark_number ?? "").toLowerCase().includes(needle),
            );
          }

          const total = rows.length;
          const limit = p.limit ?? 50;
          const limited = rows.slice(0, limit);

          return {
            source:
              "data.gov.sg /v1/transport/carpark-availability (HDB/LTA/URA)",
            timestamp: item?.timestamp ?? null,
            total_matching: total,
            returned: limited.length,
            carparks: limited,
          };
        }, "sg_carpark_availability failed"),
    },

    // -------------------------------------------------------- dengue clusters
    {
      name: "sg_dengue_clusters",
      description:
        "Active NEA dengue clusters in Singapore (live). The legacy realtime " +
        "endpoint is decommissioned (HTTP 403), so this pulls NEA's official " +
        "'Dengue Clusters (GEOJSON)' dataset and returns each cluster's locality, " +
        "case count and centroid, sorted by case size, plus totals. " +
        "Optional `min_cases` filters to larger clusters.",
      inputSchema: z.object({
        min_cases: z.number().int().nonnegative().optional(),
      }),
      handler: (input: unknown) =>
        safe(async () => {
          const p = z
            .object({ min_cases: z.number().int().nonnegative().optional() })
            .parse(input);

          const signedUrl = await waitForDownloadUrl(DENGUE_GEOJSON_DATASET, {
            maxMs: 60_000,
          });
          const res = await fetch(signedUrl);
          if (!res.ok) {
            return { error: `dengue geojson HTTP ${res.status}` };
          }
          const gj = (await res.json()) as Json;
          const feats: Json[] = gj.features ?? [];

          let clusters = feats.map((f) => {
            const props = f.properties ?? {};
            return {
              locality: props.LOCALITY ?? props.NAME ?? null,
              case_size: Number(props.CASE_SIZE ?? 0),
              recent_cases_in_homes: props.HOMES ?? null,
              public_places: props.PUBLIC_PLACES ?? null,
              construction_sites: props.CONSTRUCTION_SITES ?? null,
              centroid: centroidOf(f.geometry),
            };
          });

          if (typeof p.min_cases === "number") {
            clusters = clusters.filter((c) => c.case_size >= p.min_cases!);
          }
          clusters.sort((a, b) => b.case_size - a.case_size);

          const totalCases = clusters.reduce(
            (a, c) => a + (Number.isFinite(c.case_size) ? c.case_size : 0),
            0,
          );

          return {
            source:
              "data.gov.sg Dengue Clusters (GEOJSON), dataset " +
              `${DENGUE_GEOJSON_DATASET} (NEA)`,
            last_updated: gj.features?.length
              ? feats[0]?.properties?.FMEL_UPD_D ?? null
              : null,
            cluster_count: clusters.length,
            total_active_cases: totalCases,
            clusters,
          };
        }, "sg_dengue_clusters failed"),
    },
  ];
}

/** NEA PSI descriptor bands. */
function psiBand(psi: number | null): string | null {
  if (psi == null) return null;
  if (psi <= 50) return "Good";
  if (psi <= 100) return "Moderate";
  if (psi <= 200) return "Unhealthy";
  if (psi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

/** Rough centroid of a GeoJSON Polygon/MultiPolygon ring (averaged vertices). */
function centroidOf(geom: Json | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (!geom) return null;
  let coords: number[][] = [];
  if (geom.type === "Polygon") {
    coords = geom.coordinates?.[0] ?? [];
  } else if (geom.type === "MultiPolygon") {
    coords = geom.coordinates?.[0]?.[0] ?? [];
  } else {
    return null;
  }
  if (!coords.length) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lon += x;
    lat += y;
  }
  return {
    latitude: Math.round((lat / coords.length) * 1e6) / 1e6,
    longitude: Math.round((lon / coords.length) * 1e6) / 1e6,
  };
}
