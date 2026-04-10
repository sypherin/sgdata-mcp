/**
 * Aggregator for all non-ACRA curated dataset handlers.
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
// v0.3.0 datasets
import { unemploymentEntry, createUnemploymentTools } from "./unemployment.js";
import { populationEntry, createPopulationTools } from "./population.js";
import { diseaseCasesEntry, createDiseaseCasesTools } from "./disease_cases.js";
import { electricityEntry, createElectricityTools } from "./electricity.js";
import { birthsEntry, createBirthsTools } from "./births.js";
import { crimeEntry, createCrimeTools } from "./crime.js";
import { tourismReceiptsEntry, createTourismReceiptsTools } from "./tourism_receipts.js";
import { hawkerCentresEntry, createHawkerCentresTools } from "./hawker_centres.js";

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
  // v0.3.0
  unemploymentEntry,
  createUnemploymentTools,
  populationEntry,
  createPopulationTools,
  diseaseCasesEntry,
  createDiseaseCasesTools,
  electricityEntry,
  createElectricityTools,
  birthsEntry,
  createBirthsTools,
  crimeEntry,
  createCrimeTools,
  tourismReceiptsEntry,
  createTourismReceiptsTools,
  hawkerCentresEntry,
  createHawkerCentresTools,
};

/**
 * Return all 22 non-ACRA curated dataset registry entries.
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
    // v0.3.0
    unemploymentEntry,
    populationEntry,
    diseaseCasesEntry,
    electricityEntry,
    birthsEntry,
    crimeEntry,
    tourismReceiptsEntry,
    hawkerCentresEntry,
  ];
}

/**
 * Build the full set of ToolDefs for all 22 non-ACRA curated datasets.
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
    // v0.3.0
    ...createUnemploymentTools(cache, downloader),
    ...createPopulationTools(cache, downloader),
    ...createDiseaseCasesTools(cache, downloader),
    ...createElectricityTools(cache, downloader),
    ...createBirthsTools(cache, downloader),
    ...createCrimeTools(cache, downloader),
    ...createTourismReceiptsTools(cache, downloader),
    ...createHawkerCentresTools(cache, downloader),
  ];
}
