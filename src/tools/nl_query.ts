/**
 * Natural language query meta-tool.
 *
 * sg_ask takes a plain English question about Singapore data and
 * routes it to the most relevant tool with extracted parameters.
 * This is a keyword-based router, not LLM-based — keeps it fast
 * and dependency-free.
 */

import { z } from "zod";
import type { DatasetCache, DatasetDownloader } from "../core/index.js";
import { listDatasets } from "../core/registry.js";
import type { ToolDef } from "./index.js";

interface RouteMatch {
  tool: string;
  params: Record<string, unknown>;
  confidence: number;
}

const ROUTES: Array<{
  keywords: string[];
  tool: string;
  paramExtractor?: (q: string) => Record<string, unknown>;
}> = [
  // GDP
  { keywords: ["gdp", "economic growth", "economy growth"], tool: "sg_gdp_latest" },
  // Unemployment
  { keywords: ["unemployment", "jobless", "unemployed"], tool: "sg_unemployment_latest" },
  // CPI / inflation
  { keywords: ["cpi", "inflation", "consumer price", "cost of living"], tool: "sg_cpi_latest" },
  // Population
  { keywords: ["population", "how many people", "residents"], tool: "sg_population_latest" },
  // HDB resale
  { keywords: ["hdb resale", "flat price", "resale flat", "hdb price"], tool: "sg_hdb_resale_search" },
  // COE
  { keywords: ["coe", "certificate of entitlement", "car quota"], tool: "sg_coe_latest" },
  // Crime
  {
    keywords: ["crime", "robbery", "theft", "scam", "cheating"],
    tool: "sg_crime_latest",
    paramExtractor: (q) => {
      const types = ["robbery", "theft", "scam", "cheating", "outrage", "housebreaking"];
      const found = types.find((t) => q.toLowerCase().includes(t));
      return found ? { crime_type: found } : {};
    },
  },
  // Dengue / disease
  {
    keywords: ["dengue", "disease", "infectious", "hfmd", "tuberculosis", "chickenpox"],
    tool: "sg_disease_latest",
    paramExtractor: (q) => {
      const diseases = ["dengue", "hfmd", "tuberculosis", "chickenpox", "measles"];
      const found = diseases.find((d) => q.toLowerCase().includes(d));
      return found ? { disease: found } : {};
    },
  },
  // Electricity / energy
  { keywords: ["electricity", "energy", "power generation"], tool: "sg_electricity_latest" },
  // Births
  { keywords: ["birth", "newborn", "baby", "babies", "fertility"], tool: "sg_births_latest" },
  // Tourism
  { keywords: ["tourism", "tourist", "visitor spending"], tool: "sg_tourism_latest" },
  // Schools
  { keywords: ["school", "education", "moe", "primary school", "secondary school"], tool: "sg_moe_search_schools" },
  // Hawker
  { keywords: ["hawker", "food centre", "market"], tool: "sg_hawker_search" },
  // FX / exchange rate
  {
    keywords: ["exchange rate", "forex", "currency", "sgd", "usd"],
    tool: "sg_fx_rate",
    paramExtractor: (q) => {
      const currencies = ["usd", "eur", "gbp", "jpy", "cny", "aud", "myr", "idr", "thb", "krw", "hkd"];
      const found = currencies.find((c) => q.toLowerCase().includes(c));
      return { currency: found ?? "usd" };
    },
  },
  // Retail
  { keywords: ["retail", "shopping", "retail sales"], tool: "sg_retail_sales_latest" },
  // Childcare
  { keywords: ["childcare", "kindergarten", "preschool", "ecda"], tool: "sg_ecda_search_centres" },
  // Property
  { keywords: ["property", "condo", "private property", "ura"], tool: "sg_ura_private_txn_latest" },
  // Median income
  { keywords: ["income", "salary", "wage", "median income"], tool: "sg_median_income_lookup" },
  // Tax
  { keywords: ["tax", "iras", "revenue", "tax collection"], tool: "sg_iras_collection" },
  // Visitor arrivals
  { keywords: ["visitor arrival", "tourist arrival", "inbound"], tool: "sg_visitors_latest" },
  // HDB carpark
  { keywords: ["carpark", "parking", "hdb parking"], tool: "sg_hdb_carpark_lookup" },
];

function matchRoute(query: string): RouteMatch | null {
  const q = query.toLowerCase();
  let bestMatch: RouteMatch | null = null;
  let bestScore = 0;

  for (const route of ROUTES) {
    let score = 0;
    for (const kw of route.keywords) {
      if (q.includes(kw)) {
        // Longer keyword matches are stronger signals
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      const params = route.paramExtractor ? route.paramExtractor(q) : {};
      bestMatch = {
        tool: route.tool,
        params,
        confidence: Math.min(score / 10, 1),
      };
    }
  }
  return bestMatch;
}

const AskInput = z.object({
  question: z
    .string()
    .describe(
      "Natural language question about Singapore data, e.g. " +
      "'What is the latest unemployment rate?' or " +
      "'How many dengue cases this week?'",
    ),
});

export function createNlQueryTools(
  allTools: Map<string, ToolDef>,
): ToolDef[] {
  return [
    {
      name: "sg_ask",
      description:
        "Ask a natural language question about Singapore government " +
        "data. Automatically routes to the best matching tool. " +
        "Examples: 'What is Singapore's GDP growth?', 'How many " +
        "dengue cases?', 'Latest COE prices', 'Crime statistics'.",
      inputSchema: AskInput,
      handler: async (input: unknown) => {
        const p = AskInput.parse(input);
        const route = matchRoute(p.question);

        if (!route) {
          // Fall back to listing available datasets
          const datasets = listDatasets();
          return {
            message:
              "Could not determine which dataset to query. Here are " +
              "available datasets — try asking about a specific topic:",
            datasets: datasets.map((d) => ({
              id: d.id,
              name: d.name,
              tags: d.tags,
            })),
          };
        }

        const tool = allTools.get(route.tool);
        if (!tool) {
          return {
            message: `Matched topic but tool '${route.tool}' not found.`,
            suggestion: `Try using sg_list_datasets to find the right tool.`,
          };
        }

        let result: unknown;
        try {
          result = await tool.handler(route.params);
        } catch (err) {
          // Zod validation failed — try with empty params
          try {
            result = await tool.handler({});
          } catch {
            result = {
              error: `Tool '${route.tool}' failed: ${(err as Error).message}`,
            };
          }
        }
        return {
          question: p.question,
          matched_tool: route.tool,
          confidence: route.confidence,
          result,
        };
      },
    },
  ];
}
