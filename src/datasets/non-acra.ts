/**
 * Aggregator for all non-ACRA curated dataset handlers.
 *
 * The final `src/datasets/index.ts` barrel is being merged by another agent
 * who is writing the ACRA handler in parallel. This file exists so the
 * non-ACRA handlers can be registered as a single bundle from that merge
 * step or directly from src/index.ts while ACRA lands.
 */

import type { DatasetCache, DatasetDownloader, DatasetEntry } from "../core/index.js";
import type { ToolDef } from "../tools/index.js";

import { hdbResaleEntry, createHdbResaleTools } from "./hdb_resale.js";
import { coeBiddingEntry, createCoeBiddingTools } from "./coe_bidding.js";
import { moeSchoolsEntry, createMoeSchoolsTools } from "./moe_schools.js";
import { hdbCarparksEntry, createHdbCarparksTools } from "./hdb_carparks.js";
import { gdpYoyEntry, createGdpYoyTools } from "./gdp_yoy.js";
import { cpiMonthlyEntry, createCpiMonthlyTools } from "./cpi_monthly.js";
import { medianIncomeEntry, createMedianIncomeTools } from "./median_income.js";
import {
  employmentSectorEntry,
  createEmploymentSectorTools,
} from "./employment_sector.js";
import {
  uraPrivatePropertyEntry,
  createUraPrivatePropertyTools,
} from "./ura_private_property.js";
import {
  visitorArrivalsEntry,
  createVisitorArrivalsTools,
} from "./visitor_arrivals.js";
import { retailSalesEntry, createRetailSalesTools } from "./retail_sales.js";
import { masFxEntry, createMasFxTools } from "./mas_fx.js";
import {
  irasTaxCollectionEntry,
  createIrasTaxCollectionTools,
} from "./iras_tax_collection.js";
import { ecdaChildcareEntry, createEcdaChildcareTools } from "./ecda_childcare.js";

export {
  hdbResaleEntry,
  createHdbResaleTools,
  coeBiddingEntry,
  createCoeBiddingTools,
  moeSchoolsEntry,
  createMoeSchoolsTools,
  hdbCarparksEntry,
  createHdbCarparksTools,
  gdpYoyEntry,
  createGdpYoyTools,
  cpiMonthlyEntry,
  createCpiMonthlyTools,
  medianIncomeEntry,
  createMedianIncomeTools,
  employmentSectorEntry,
  createEmploymentSectorTools,
  uraPrivatePropertyEntry,
  createUraPrivatePropertyTools,
  visitorArrivalsEntry,
  createVisitorArrivalsTools,
  retailSalesEntry,
  createRetailSalesTools,
  masFxEntry,
  createMasFxTools,
  irasTaxCollectionEntry,
  createIrasTaxCollectionTools,
  ecdaChildcareEntry,
  createEcdaChildcareTools,
};

/**
 * Return all 14 non-ACRA curated dataset registry entries.
 */
export function allCuratedEntries(): DatasetEntry[] {
  return [
    hdbResaleEntry,
    coeBiddingEntry,
    moeSchoolsEntry,
    hdbCarparksEntry,
    gdpYoyEntry,
    cpiMonthlyEntry,
    medianIncomeEntry,
    employmentSectorEntry,
    uraPrivatePropertyEntry,
    visitorArrivalsEntry,
    retailSalesEntry,
    masFxEntry,
    irasTaxCollectionEntry,
    ecdaChildcareEntry,
  ];
}

/**
 * Build the full set of ToolDefs for all 14 non-ACRA curated datasets.
 */
export function createAllCuratedTools(
  cache: DatasetCache,
  downloader: DatasetDownloader,
): ToolDef[] {
  return [
    ...createHdbResaleTools(cache, downloader),
    ...createCoeBiddingTools(cache, downloader),
    ...createMoeSchoolsTools(cache, downloader),
    ...createHdbCarparksTools(cache, downloader),
    ...createGdpYoyTools(cache, downloader),
    ...createCpiMonthlyTools(cache, downloader),
    ...createMedianIncomeTools(cache, downloader),
    ...createEmploymentSectorTools(cache, downloader),
    ...createUraPrivatePropertyTools(cache, downloader),
    ...createVisitorArrivalsTools(cache, downloader),
    ...createRetailSalesTools(cache, downloader),
    ...createMasFxTools(cache, downloader),
    ...createIrasTaxCollectionTools(cache, downloader),
    ...createEcdaChildcareTools(cache, downloader),
  ];
}
