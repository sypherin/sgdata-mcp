# sgdata-mcp — Dataset Catalog

The 15 datasets below are the curated business-intelligence surface area for the Singapore data MCP server. They were picked to cover the SG economy, corporate landscape, real estate, labour market, prices/inflation, capital flows, public services and the regulatory landscape — and to deliberately avoid the real-time weather/traffic/carpark-availability tools that `vdineshk/sgdata-mcp` already covers.

All entries below are confirmed `format: "CSV"` via the data.gov.sg v2 metadata endpoint, and every dataset has at least one human-readable column name in `columnMetadata.map` (no all-opaque `c_xxx` payloads).

API base used for verification:
```
https://api-production.data.gov.sg/v2/public/api/datasets/{datasetId}/metadata
https://api-production.data.gov.sg/v2/public/api/collections/{collectionId}/metadata
```

Last verified: 2026-04-08.

---

## ACRA Information on Corporate Entities
- **Registry id**: `acra_entities`
- **Dataset ID(s)**: `d_8575e84912df3c28995b8e6e0e05205a` (A), `d_af2042c77ffaf0db5d75561ce9ef5688` (W), `d_0cc5f52a1f298b916f317800251057f3`, `d_4e3db8955fdcda6f9944097bef3d2724` (Z), `d_1cd970d8351b42be4a308d628a6dd9d3` (X), `d_e97e8e7fc55b85a38babf66b0fa46b73`, `d_df7d2d661c0c11a7c367c9ee4bf896c1`, `d_fa2ed456cf2b8597bb7e064b08fc3c7c`, `d_300ddc8da4e8f7bdc1bfc62d0d99e2e7`, `d_31af23fdb79119ed185c256f03cb5773`, `d_67e99e6eabc4aad9b5d48663b579746a`, `d_c0650f23e94c42e7a20921f4c5b75c24`, `d_3a3807c023c61ddfba947dc069eb53f2`, `d_478f45a9c541cbe679ca55d1cd2b970b`, `d_a2141adf93ec2a3c2ec2837b78d6d46e`, `d_181005ca270b45408b4cdfc954980ca2`, `d_9af9317c646a1c881bb5591c91817cc6` (M), `d_5c4ef48b025fdfbc80056401f06e3df9`, `d_5573b0db0575db32190a2ad27919a7aa` (K), `d_2b8c54b2a490d2fa36b925289e5d9572` (R), `d_85518d970b8178975850457f60f1e738`, `d_72f37e5c5d192951ddc5513c2b134482`, `d_4526d47d6714d3b052eed4a30b8b1ed6`, `d_b58303c68e9cf0d2ae93b73ffdbfbfa1` (G), `d_acbc938ec77af18f94cecc4a7c9ec720`, `d_4130f1d9d365d9f1633536e959f62bb7`, `d_124a9bd407c7a25f8335b93b86e50fdd` (27 shards total — one per first-letter-of-entity-name plus an "others" bucket)
- **Collection ID**: `2`
- **Shard collection**: yes
- **Agency**: ACRA (Accounting and Corporate Regulatory Authority)
- **Update frequency**: monthly
- **Row count**: ~2.0M+ active and historical entities (across all shards)
- **Size**: ~480 MB across 27 CSV shards (~18 MB each)
- **Key columns**: `uen`, `entity_name`, `entity_type_description`, `entity_status_description`, `registration_incorporation_date`, `uen_issue_date`, `primary_ssic_code`, `primary_ssic_description`, `secondary_ssic_code`, `secondary_ssic_description`, `postal_code`, `street_name`, `no_of_officers`
- **Example tool(s)** we could expose:
  - `sg_acra_search_entities(query?, ssic?, status?, incorporated_after?, incorporated_before?, postal_code_prefix?, limit?)` — full-text + filtered search across all shards
  - `sg_acra_get_entity(uen)` — exact lookup by UEN
  - `sg_acra_formations_by_ssic(ssic_prefix, year)` — count incorporations in a given SSIC bucket per year
- **Example use cases**:
  - "Find all AI/ML companies (SSIC 62019/62022) incorporated in 2025"
  - "Look up DBS Bank Ltd by UEN 196800306E"
  - "List all live food & beverage entities in postal code 0788xx"
  - "How many fintech entities were formed in Q1 2026 vs Q1 2025?"
- **Refresh cadence recommendation**: monthly. Re-fetch the full collection on the 15th of each month (ACRA publishes a full snapshot mid-month — last verified update 2026-03-13).

---

## HDB Resale Flat Prices (Jan 2017+)
- **Registry id**: `hdb_resale`
- **Dataset ID(s)**: `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`
- **Collection ID**: `189` (the full collection contains 5 datasets covering 1990–2014 history; we ship the 2017+ one as the live tool and treat the historical shards as optional backfill)
- **Shard collection**: no (single dataset)
- **Agency**: HDB (Housing & Development Board)
- **Update frequency**: monthly
- **Row count**: ~210k transactions (Jan 2017 → present, growing ~2.5k/month)
- **Size**: ~22.6 MB
- **Key columns**: `month`, `town`, `flat_type`, `block`, `street_name`, `storey_range`, `floor_area_sqm`, `flat_model`, `lease_commence_date`, `remaining_lease`, `resale_price`
- **Example tool(s)** we could expose:
  - `sg_hdb_resale_search(town?, flat_type?, month_from?, month_to?, min_price?, max_price?, limit?)`
  - `sg_hdb_resale_stats(town?, flat_type?, period?)` — median/mean/min/max + count
  - `sg_hdb_resale_psf_trend(town, flat_type, granularity)` — monthly $/sqft trend
- **Example use cases**:
  - "What did 4-room flats in Punggol resell for in March 2026?"
  - "Median PSF for executive flats across all towns over the last 12 months"
  - "Show me the cheapest 5-room transactions in the last 90 days"
- **Refresh cadence recommendation**: weekly. HDB updates this dataset on a rolling basis (last verified 2026-04-08), and the file is small enough that a weekly re-pull is cheap.

---

## COE Bidding Results / Prices
- **Registry id**: `coe_bidding`
- **Dataset ID(s)**: `d_69b3380ad7e51aff3a7dcc84eba52b8a`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: LTA (Land Transport Authority)
- **Update frequency**: monthly (two bidding exercises per month)
- **Row count**: ~2,500 (every bidding exercise × 5 vehicle categories since the 2000s)
- **Size**: ~78 KB
- **Key columns**: `month`, `bidding_no`, `vehicle_class`, `quota`, `bids_success`, `bids_received`, `premium`
- **Example tool(s)** we could expose:
  - `sg_coe_latest(category?)` — most recent successful premium per category
  - `sg_coe_history(category, months_back?)` — premium time series
  - `sg_coe_demand_supply(category, months_back?)` — bids_received/quota oversubscription ratio
- **Example use cases**:
  - "What is the latest COE Cat A premium?"
  - "5-year history of Cat E premiums for content marketing charts"
  - "Has Cat B been oversubscribed in the last 6 bidding exercises?"
- **Refresh cadence recommendation**: weekly. New rounds drop on alternate Wednesdays — a weekly poll catches them within 7 days, and the file is tiny.

---

## MOE General Information of Schools
- **Registry id**: `moe_schools`
- **Dataset ID(s)**: `d_688b934f82c1059ed0a6993d2a829089`
- **Collection ID**: `457` (broader School Directory & Information collection)
- **Shard collection**: no
- **Agency**: MOE (Ministry of Education)
- **Update frequency**: annual (last verified 2025-11-05)
- **Row count**: ~350 schools (primary, secondary, pre-university)
- **Size**: ~134 KB
- **Key columns**: `school_name`, `address`, `postal_code`, `telephone_no`, `email_address`, `mrt_desc`, `bus_desc`, `principal_name`, `dgp_code`, `zone_code`, `type_code`, `nature_code`, `session_code`, `mainlevel_code`, `sap_ind`, `gifted_ind`
- **Example tool(s)** we could expose:
  - `sg_moe_search_schools(query?, level?, zone?, sap?, gifted?, limit?)`
  - `sg_moe_school_by_name(name)`
  - `sg_moe_schools_near(postal_code, radius_km?)`
- **Example use cases**:
  - "List all SAP schools in the East zone"
  - "Which secondary schools offer the Gifted Education Programme?"
  - "Find schools near postal code 460123"
- **Refresh cadence recommendation**: quarterly. The dataset updates roughly once per academic year — a quarterly pull is more than sufficient.

---

## HDB Carpark Information (static metadata, not real-time availability)
- **Registry id**: `hdb_carpark_info`
- **Dataset ID(s)**: `d_23f946fa557947f93a8043bbef41dd09`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: HDB (Housing & Development Board)
- **Update frequency**: monthly
- **Row count**: ~2,200 carparks
- **Size**: ~304 KB
- **Key columns**: `car_park_no`, `address`, `x_coord`, `y_coord` (SVY21), `car_park_type`, `type_of_parking_system`, `short_term_parking`, `free_parking`, `night_parking`, `car_park_decks`, `gantry_height`, `car_park_basement`
- **Example tool(s)** we could expose:
  - `sg_hdb_carpark_lookup(car_park_no)`
  - `sg_hdb_carparks_by_address(query)`
  - `sg_hdb_carparks_by_type(car_park_type?, has_night_parking?, free_parking?)`
- **Example use cases**:
  - "Where are all the multi-storey carparks with free Sunday parking in Tampines?"
  - "Look up carpark BJ55 — operating hours, payment system, gantry height"
- **Refresh cadence recommendation**: monthly. This is the static reference table (NOT the real-time availability feed vdineshk handles).

---

## GDP Year-on-Year Growth Rate, Quarterly
- **Registry id**: `singstat_gdp_growth`
- **Dataset ID(s)**: `d_a5ff719648a0e6d4b4c623ee383ab686`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Singapore Department of Statistics (SingStat)
- **Update frequency**: quarterly
- **Row count**: ~80 series rows (one row per industry / sub-industry, wide format with one column per quarter)
- **Size**: ~73 KB
- **Key columns**: `DataSeries` (industry breakdown such as "GDP At Constant 2015 Market Prices", "Manufacturing", "Construction", "Services Producing Industries", etc.) plus 200 dated columns: `20254Q`, `20253Q`, … back to the 1970s
- **Example tool(s)** we could expose:
  - `sg_gdp_latest(industry?)` — most recent YoY growth for headline GDP or a sub-industry
  - `sg_gdp_history(industry, quarters_back?)` — time series of YoY growth
  - `sg_gdp_industry_compare(quarter)` — all industries ranked by YoY growth for a given quarter
- **Example use cases**:
  - "What was Singapore's GDP growth last quarter?"
  - "How has the manufacturing sector's YoY growth trended over the last 8 quarters?"
  - "Which sectors contracted in 2025Q4?"
- **Refresh cadence recommendation**: monthly. SingStat publishes early ("advance estimate") then revised numbers — a monthly poll catches both.

---

## Consumer Price Index (CPI), 2024 Base, Monthly
- **Registry id**: `singstat_cpi`
- **Dataset ID(s)**: `d_bdaff844e3ef89d39fceb962ff8f0791`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Singapore Department of Statistics (SingStat)
- **Update frequency**: monthly
- **Row count**: ~780 series rows (one row per CPI sub-index, wide format with one column per month)
- **Size**: ~975 KB
- **Key columns**: `DataSeries` (e.g. "All Items", "Food", "Food Excl Food Serving Services", "Housing & Utilities", "Transport", "Health Care", "Recreation & Culture", "Education", "Communication") plus monthly columns `2026Feb`, `2026Jan`, … back to the 1960s
- **Example tool(s)** we could expose:
  - `sg_cpi_latest(category?)` — most recent month's index value and YoY change
  - `sg_cpi_history(category, months_back?)` — time series
  - `sg_cpi_yoy(category, month?)` — year-on-year inflation for a given category
- **Example use cases**:
  - "What's Singapore's headline CPI inflation for the latest month?"
  - "How has food inflation trended over the last 24 months?"
  - "Which CPI categories are running hottest in 2026?"
- **Refresh cadence recommendation**: monthly. New month's CPI typically lands on the 23rd — a monthly cron the day after is ideal.

---

## Median Gross Monthly Income From Employment by Sex
- **Registry id**: `mom_median_income`
- **Dataset ID(s)**: `d_aa75b9227b47cbc12ffe0e3be4979546`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Ministry of Manpower (MOM)
- **Update frequency**: annual
- **Row count**: ~120 (year × sex × incl/excl employer CPF)
- **Size**: ~1.1 KB
- **Key columns**: `year`, `sex`, `median_income_incl_emp_cpf`, `median_income_excl_emp_cpf`
- **Example tool(s)** we could expose:
  - `sg_mom_median_income(year?, sex?)`
  - `sg_mom_income_history(sex?, years_back?)`
- **Example use cases**:
  - "What's the median monthly wage for full-time Singaporean workers in 2025?"
  - "How has the male/female wage gap trended over the last 10 years?"
- **Refresh cadence recommendation**: annual. New data lands once a year (around Q1) — an annual or quarterly poll suffices.

---

## Employment (Persons) by Sector, Annual
- **Registry id**: `singstat_employment_by_sector`
- **Dataset ID(s)**: `d_d2518fed6cc2014f0cd061b4570a9592`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Singapore Department of Statistics (SingStat) / sourced from MOM
- **Update frequency**: annual
- **Row count**: ~25 series rows (one per sector, wide format with one column per year)
- **Size**: ~2.8 KB
- **Key columns**: `DataSeries` (e.g. "Total", "Manufacturing", "Construction", "Wholesale & Retail Trade", "Information & Communications", "Financial & Insurance Services", "Professional Services") plus annual columns `2023`, `2022`, … back to ~2000
- **Example tool(s)** we could expose:
  - `sg_employment_by_sector(year?)`
  - `sg_employment_sector_history(sector, years_back?)`
  - `sg_employment_growth(sector, base_year, target_year)` — % change
- **Example use cases**:
  - "How many people work in financial services in Singapore?"
  - "Which sectors grew employment fastest 2018→2023?"
- **Refresh cadence recommendation**: annual. This is a once-a-year publication.

---

## URA Private Residential Property Transactions, Quarterly
- **Registry id**: `ura_private_residential_txn`
- **Dataset ID(s)**: `d_7c69c943d5f0d89d6a9a773d2b51f337`
- **Collection ID**: n/a (related collection 1676 covers price indices)
- **Shard collection**: no
- **Agency**: URA (Urban Redevelopment Authority)
- **Update frequency**: quarterly
- **Row count**: ~600 (quarter × type-of-sale × sale-status combinations)
- **Size**: ~12 KB
- **Key columns**: `quarter`, `type_of_sale` (New Sale / Sub-Sale / Resale), `sale_status`, `units`
- **Example tool(s)** we could expose:
  - `sg_ura_private_txn_latest()`
  - `sg_ura_private_txn_history(type_of_sale?, quarters_back?)`
  - `sg_ura_new_sale_pipeline(quarters_back?)` — new sale volume only
- **Example use cases**:
  - "How many new private residential units were sold in 2025Q4?"
  - "Resale vs new sale volume trend in the private market over 8 quarters"
- **Refresh cadence recommendation**: quarterly. URA publishes shortly after quarter-end — a monthly poll guarantees fresh data within 30 days.

---

## International Visitor Arrivals by Place of Residence, Monthly
- **Registry id**: `stb_visitor_arrivals`
- **Dataset ID(s)**: `d_7e7b2ee60c6ffc962f80fef129cf306e`
- **Collection ID**: `1622` (Visitor International Arrivals to Singapore)
- **Shard collection**: no
- **Agency**: Singapore Tourism Board (STB) / SingStat
- **Update frequency**: monthly
- **Row count**: ~50 series rows (one per source country/region, wide format with one column per month)
- **Size**: ~101 KB
- **Key columns**: `DataSeries` (e.g. "Total International Visitor Arrivals", "China", "Indonesia", "India", "Malaysia", "Australia", "United Kingdom", "USA", "Japan", "South Korea", "Vietnam", "Philippines") plus monthly columns `2026Jan`, `2025Dec`, … back to the 1980s
- **Example tool(s)** we could expose:
  - `sg_visitors_latest(country?)`
  - `sg_visitors_history(country?, months_back?)`
  - `sg_visitors_top_sources(month?, n?)`
- **Example use cases**:
  - "How many Chinese tourists came to Singapore last month?"
  - "Has Indonesian visitor volume recovered to pre-2020 levels?"
  - "Top 10 source markets for SG tourism in 2025"
- **Refresh cadence recommendation**: monthly. New month's data drops mid-month for the previous month.

---

## Retail Sales Index (2017=100), In Chained Volume Terms, Monthly
- **Registry id**: `singstat_retail_sales`
- **Dataset ID(s)**: `d_6b78d625911483860e162288a4000a0c`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Singapore Department of Statistics (SingStat)
- **Update frequency**: monthly
- **Row count**: ~30 series rows (one per retail sub-industry, wide format with one column per month)
- **Size**: ~72 KB
- **Key columns**: `DataSeries` (e.g. "Total", "Total Excluding Motor Vehicles", "Department Stores", "Supermarkets & Hypermarkets", "Food & Alcohol", "Wearing Apparel & Footwear", "Furniture & Household Equipment", "Recreational Goods", "Watches & Jewellery", "Petrol Service Stations", "Optical Goods & Books", "Computer & Telecommunications Equipment") plus monthly columns `2025Dec`, `2025Nov`, … back to ~1985
- **Example tool(s)** we could expose:
  - `sg_retail_sales_latest(category?)`
  - `sg_retail_sales_history(category?, months_back?)`
  - `sg_retail_sales_yoy(category, month?)`
- **Example use cases**:
  - "How is Singapore retail trending YoY?"
  - "Which retail sub-sectors are still below 2019 baseline?"
  - "Department store sales trend over 24 months"
- **Refresh cadence recommendation**: monthly. New month lands ~5 weeks after the period ends.

---

## MAS Exchange Rates (Average for Period), Monthly
- **Registry id**: `mas_exchange_rates_monthly`
- **Dataset ID(s)**: `d_b2b7ffe00aaec3936ed379369fdf531b`
- **Collection ID**: n/a (related daily series under collection 1353)
- **Shard collection**: no
- **Agency**: Monetary Authority of Singapore (MAS) — published via SingStat
- **Update frequency**: monthly
- **Row count**: ~30 series rows (one per currency pair, wide format with one column per month)
- **Size**: ~61 KB
- **Key columns**: `DataSeries` (e.g. "U S Dollar", "Euro", "Pound Sterling", "Japanese Yen (Per 100)", "Australian Dollar", "Hong Kong Dollar (Per 100)", "Chinese Renminbi (Per 100)", "Malaysian Ringgit (Per 100)", "Indonesian Rupiah (Per 100)", "Thai Baht (Per 100)") plus monthly columns `2026Jan`, `2025Dec`, … back to the 1980s
- **Example tool(s)** we could expose:
  - `sg_fx_rate(currency, month?)` — monthly average SGD per unit
  - `sg_fx_history(currency, months_back?)`
  - `sg_fx_basket(month?)` — all major pairs at once
- **Example use cases**:
  - "What was the SGD/USD average in Jan 2026?"
  - "12-month trend of SGD against the Chinese yuan"
  - "How has the SGD strengthened or weakened against major trading partners YTD?"
- **Refresh cadence recommendation**: monthly. New month posts on the second week of the following month.

---

## IRAS Collection by Tax Type, Annual
- **Registry id**: `iras_tax_collection`
- **Dataset ID(s)**: `d_21e22578cabce897e8b27801e5596140`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Inland Revenue Authority of Singapore (IRAS)
- **Update frequency**: annual
- **Row count**: ~200 (financial year × tax type, going back to FY1960s)
- **Size**: ~6.4 KB
- **Key columns**: `financial_year`, `tax_type` (Corporate Income Tax, Individual Income Tax, Withholding Tax, Goods and Services Tax, Property Tax, Stamp Duty, Betting Taxes, Estate Duty), `tax_collected`
- **Example tool(s)** we could expose:
  - `sg_iras_collection(tax_type?, financial_year?)`
  - `sg_iras_collection_history(tax_type, years_back?)`
  - `sg_iras_tax_mix(financial_year)` — percentage breakdown by tax type
- **Example use cases**:
  - "How much did IRAS collect in corporate income tax in FY2024?"
  - "What share of total tax revenue does GST represent?"
  - "Has stamp duty collection grown over the last 10 years?"
- **Refresh cadence recommendation**: annual (poll quarterly to catch the FY-end publication, usually around Aug–Sep).

---

## ECDA Listing of Childcare & Kindergarten Centres
- **Registry id**: `ecda_preschools`
- **Dataset ID(s)**: `d_696c994c50745b079b3684f0e90ffc53`
- **Collection ID**: n/a
- **Shard collection**: no
- **Agency**: Early Childhood Development Agency (ECDA)
- **Update frequency**: daily (this is one of the most aggressively-updated CSVs on data.gov.sg — last verified 2026-04-08)
- **Row count**: ~2,300 active centres
- **Size**: ~1.7 MB
- **Key columns**: `centre_code`, `centre_name`, `organisation_description`, `service_model`, `centre_contact_no`, `centre_email_address`, `centre_address`, `postal_code`, `centre_website`, `infant_vacancy_current_month`, `infant_vacancy_next_month`, `pg_vacancy_current_month`, `n1_vacancy_current_month`, `n2_vacancy_current_month`, `k1_vacancy_current_month`, `k2_vacancy_current_month`, `spark_certified`
- **Example tool(s)** we could expose:
  - `sg_ecda_search_centres(query?, postal_prefix?, service_model?, has_infant_vacancy?, spark_certified?, limit?)`
  - `sg_ecda_centres_near(postal_code, radius_km?)`
  - `sg_ecda_vacancy_summary(level, postal_prefix?)`
- **Example use cases**:
  - "Find all SPARK-certified childcare centres with infant vacancies in postal sector 60"
  - "Look up Skool4Kidz centres in Punggol and their K2 vacancy this month"
  - "How many preschools are within 2 km of postal code 510123?"
- **Refresh cadence recommendation**: daily. ECDA pushes vacancy updates daily — schedule a 04:00 SGT pull to keep the cache current for morning queries.

---

# Notes & "didn't make the top 15" candidates

A few datasets we explored that look great but didn't make the top 15 — keep these in mind for v2:

- **HDB Resale historical shards** (`d_43f493c6c50d54243cc1eab0df142d6a` 2000–Feb 2012, `d_2d5ff9ea31397b66239f245f57751537` Mar 2012–Dec 2014, `d_ea9ed51da2787afaf8e51f827c304208` Jan 2015–Dec 2016, `d_ebc5ab87086db484f88045b47411ebc5` 1990–1999) — collection 189 — useful for long-term trend analysis if we want to extend `hdb_resale` past 2017.
- **URA Private Residential Property Price Index** (`d_97f8a2e995022d311c6c68cfda6d034c` headline, `d_da00b36ca8c831322fa0bb2a3378a476` by property type) — quarterly, useful companion to `ura_private_residential_txn`.
- **Business Expectations of the Services Sector** (`d_cec2114868fe6be90ae2118ae68c3c9f` revenue, `d_c52d871176ed7c3f4991fbc29fbb0512` 6-month outlook) — quarterly leading indicator.
- **Share of Non-Resident Population by Pass Type** (`d_94fd56bdb981f0f966cb487d8247bf1a`) — annual, work pass mix breakdown for labour-market analysis.
- **Total Government Operating Revenue and IRAS Collection** (`d_585cd3479aa16f2b741ac67fa0497628`) — companion to `iras_tax_collection`, smaller and shows IRAS share of total gov revenue.
- **HSA Listing of Licensed Pharmacies** (`d_bc50d72a9d61457964c6ea8d8ba7dce2`) and **HSA Licensed Health Product Companies** (`d_bf50ce0f3f42f69d7acd50635afa62da`) — small CSV directories useful for healthcare/lifesciences sector mapping.
- **MOH Health Facilities** (`d_e4663ad3f088a46dabd3972dc166402d`) — small lookup of clinics/dental/pharmacies counts by sector.
- **Master Plan 2019 Planning Area / Subzone Boundaries** (`d_4765db0e87b9c86336792efe8a1f7a66` planning areas, `d_8594ae9ff96d0c708bc2af633048edfb` subzones) — these are GEOJSON not CSV so they were excluded by the format constraint, but they are essential if we ever add a geo-resolution layer (e.g. to convert HDB resale `town` to URA planning area / subzone).
- **MAS Daily Exchange Rates** (`d_046ff8d521a218d9178178cfbfc45c2c`) — daily granularity SGD/USD; we picked the monthly version because the daily one is heavier and most BI use cases don't need daily resolution.
- **Singstat Income Components of GDP** (`d_48bdb9e9c650d8d64f405933d006eaaf`) and **GDP By Industry SSIC 2020** (`d_df200b7f89f94e52964ff45cd7878a30`) — deeper GDP cuts useful for sector-specific analysis.
- **A canonical SSIC code → description lookup** could not be located as a standalone CSV on data.gov.sg in this pass (SingStat hosts the SSIC catalogue as a PDF on their own site, not as a published d_xxx dataset). For now, our cache layer can derive the SSIC code → description mapping by deduplicating the `primary_ssic_code` / `primary_ssic_description` columns out of the ACRA shards — this is a pragmatic workaround that gives us a 1k-row lookup table for free.
- **Planning area name lookup** is similarly not available as a standalone CSV — it lives inside the GEOJSON properties of the master plan files. Same workaround: derive it from the geometry file once and cache.

All dataset IDs above were verified live against the v2 metadata API on 2026-04-08.
