# Water Inspector: Product and Technical Spec

Version 1.0 (2026-09-30)

## 1. Summary

Water Inspector is a browser app built around a 3D map. The user clicks a lake, river, reservoir, bay or pond. The app pulls hydrography, water quality, impairment and biodiversity data for that waterbody and shows it in a detail panel. From the panel the user switches between several 3D scenes: the waterbody lifted out of the terrain with its bathymetry, an underwater view where the resident species swim around, a water-column cross-section, and a pollutant view.

Coverage target for v1 is the continental United States, because the richest open water data (EPA, USGS) is US-federal. Anywhere else in the world the app still works in a reduced mode using OpenStreetMap geometry and GBIF species records.

## 2. Goals and non-goals

Goals
- Click any mapped waterbody and get a useful profile in under 3 seconds on a warm cache.
- Show where every number came from, and when it was measured. Estimated values are labelled as estimates.
- 3D scenes are driven by the data. Turbidity changes underwater visibility. Measured species appear as fish. Depth drives the bathymetry mesh.
- Work fully offline in a demo mode with bundled sample data, so the app can be developed, tested and demoed with no network.

Non-goals for v1
- User accounts, saved lists, sharing.
- Uploading your own samples.
- Health or safety advice. The app shows data and published screening thresholds. It never says "safe to swim" or "safe to eat".
- Mobile-native apps. The web app must be usable on a phone, though 3D scenes may run at reduced quality.

## 3. Users and core flows

Personas: a curious member of the public, an angler, a student, an environmental volunteer.

Flow A: explore
1. App opens on a 3D map (tilted, terrain on) centred on the continental US.
2. User pans, zooms, or searches a place name.
3. Waterbodies highlight on hover.
4. Click opens the Inspector panel for that waterbody.

Flow B: inspect
1. Inspector shows a header (name, type, state, area) and tabs: Overview, Water Quality, Pollutants and Impairments, Life, Sources.
2. Each section loads independently with its own skeleton and error state. One failing source never blanks the panel.

Flow C: view in 3D
1. A view switcher in the Inspector offers: Map, Raised Terrain, Underwater, Cross-Section, Pollutants.
2. Choosing a 3D view takes over the main canvas with a transition. The panel stays docked and collapsible.
3. Esc or the Map button returns to the map at the same camera position.

## 4. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite, TypeScript (strict) | Fast, simple |
| UI | React 19, Tailwind CSS | Common, fast to build |
| State | Zustand (UI and selection), TanStack Query (server data, caching, retries) | Clean split between app state and fetched data |
| Map | MapLibre GL JS 5.x via `react-map-gl/maplibre` | Open source, supports 3D terrain and pitch, no API key |
| Basemap tiles | OpenFreeMap vector style (`https://tiles.openfreemap.org/styles/liberty`) | Free, no key |
| Terrain DEM | AWS Open Data terrain tiles, Terrarium encoding (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`) | Free, global, no key |
| 3D scenes | three.js via `@react-three/fiber` and `@react-three/drei`, postprocessing via `@react-three/postprocessing` | Full control over custom scenes and shaders |
| Geometry | `@turf/turf` | Area, simplify, buffer, centroid, point-in-polygon |
| Backend proxy | Small Node server using Hono, in `server/` | Solves CORS, hides API keys, caches responses |
| Tests | Vitest (unit), Playwright (e2e, Chromium at `/opt/pw-browsers/chromium` in CI container) | |
| Lint and format | ESLint (typescript-eslint), Prettier | |

Monorepo layout with npm workspaces:

```
/
  SPEC.md
  README.md
  package.json            (workspaces: app, server, shared)
  app/                    (Vite React client)
  server/                 (Hono proxy + adapters)
  shared/                 (TypeScript types, unit conversion, thresholds, species catalog)
  fixtures/               (demo-mode sample data)
```

## 5. Architecture

```
Browser (app)
  MapLibre map  ──click──▶  selection store (waterbody id + geometry)
  Inspector panel  ◀── TanStack Query ──▶  /api/*  (server)
  R3F scenes  ◀── derived SceneModel (pure function of the profile)

Server (Hono)
  /api/waterbody/at?lat&lon        → geometry + identity
  /api/waterbody/:id/profile       → full WaterbodyProfile (fan-out, partial results allowed)
  /api/waterbody/:id/quality       → quality section only
  /api/waterbody/:id/life          → life section only
  /api/waterbody/:id/impairments   → impairments section only
  /api/search?q                    → place search (Nominatim)
  Adapters (one file per source) → normalizers → shared types
  Cache: in-memory LRU + optional on-disk JSON cache (server/.cache), TTL per source
  DEMO_MODE=1 → every adapter reads from /fixtures instead of the network
```

Rules
- The client never calls third-party data APIs directly. Tiles (basemap, DEM) are the only direct third-party requests from the browser.
- Every adapter returns `SourceResult<T>` with `status: "ok" | "empty" | "error" | "unsupported"`, the data, the source name, the URL used, and a `retrievedAt` timestamp.
- The profile endpoint runs adapters in parallel with a per-adapter timeout (8 s) and returns whatever succeeded.
- Rate-limit politely: max 2 concurrent requests per upstream host, a descriptive `User-Agent` including the repo URL.

## 6. Data sources and adapters

Build each adapter behind the same interface so sources can be swapped. The container this repo is built in has no access to these hosts, so every adapter must also have a fixture file and a unit test against that fixture. Endpoint details below were checked in September 2026; the implementer should keep base URLs in `server/src/config.ts` so they can be corrected without code changes.

### 6.1 Waterbody geometry and identity

| Priority | Source | Use |
|---|---|---|
| 1 | USGS NHD via The National Map ArcGIS REST, `https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer` (Waterbody layers; look up layer ids from `?f=pjson` at startup) | US lakes, ponds, reservoirs, estuaries. Query by point with `geometry=lon,lat&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson` |
| 1 | Same service, Area layer + Flowline layer | Wide rivers (Area) and narrow rivers (Flowline, buffered 30 m for click tolerance) |
| 2 | OpenStreetMap via Overpass API (`https://overpass-api.de/api/interpreter`) | Global fallback. Query `is_in` / `way(around:…)` for `natural=water`, `waterway=riverbank`, `water=*` |
| 3 | Nominatim (`https://nominatim.openstreetmap.org/search`) | Search box only. Respect the 1 request/second policy |

Map highlighting: draw hovered and selected geometry on the client from the returned GeoJSON. For hover before click, use the basemap's own `water` layer in the OpenFreeMap style with `queryRenderedFeatures`, then resolve to NHD on click.

Waterbody id format: `nhd:{permanent_identifier}` or `osm:{way|relation}/{id}`.

### 6.2 Physical properties and depth

| Field | Source |
|---|---|
| Surface area, perimeter, shoreline development index | Computed with turf from geometry |
| Surface elevation | NHD attributes if present, otherwise sample the Terrarium DEM at 5 interior points and take the median |
| Max and mean depth, volume | 1) HydroLAKES / GLOBathy attributes when a match exists (see below). 2) Otherwise estimate |
| Bathymetry surface | Synthesised (section 8.2) from max depth and shape; labelled "modelled" |

HydroLAKES and GLOBathy are file downloads, not APIs. For v1 include a build script `server/scripts/build-lake-depth-index.ts` that, given the HydroLAKES shapefile and GLOBathy max-depth table on local disk, writes a compact JSON index `{hylak_id, lon, lat, area_km2, depth_avg_m, depth_max_m, vol_mcm}` for lakes over 0.1 km² in the US. Do not run it in CI. Ship `fixtures/lake-depth-index.sample.json` with the demo lakes only. Match a selected waterbody to the index by centroid-in-polygon plus area within 30%.

Depth estimate fallback when no match: use the median slope of the DEM in a 500 m ring around the shoreline and the lake's mean distance-to-shore, `maxDepth ≈ slope × maxDistanceToShore × 0.5`, clamped to [1, 300] m. Mark `estimated: true` and show "Estimated from surrounding terrain" in the UI.

### 6.3 Water quality (measured parameters)

| Source | Endpoint | Use |
|---|---|---|
| Water Quality Portal (EPA/USGS/state data, WQX) | `https://www.waterqualitydata.us/data/Station/search` and `/data/Result/search` (legacy profile). WQX 3.0 profiles are at `/beta/`. Use `bBox` from the waterbody bbox, `mimeType=csv` or `geojson`, `startDateLo` = 5 years ago, `providers=NWIS&providers=STORET` | Station list inside the polygon, then results for the characteristics in section 7 |
| USGS Water Data OGC API | `https://api.waterdata.usgs.gov/ogcapi/v0/collections` (monitoring-locations, latest-continuous, daily) | Near-real-time water temperature, DO, turbidity, specific conductance at USGS sites inside or on the waterbody |

Notes
- WQP moved to a new cloud environment on 2026-08-31 and is phasing in WQX 3.0 through 2028. Keep both legacy and beta profile paths in config and prefer legacy until beta returns results for a test query.
- Filter stations to those whose point lies inside the polygon or within 100 m of the shore (rivers: within the buffered flowline).
- Aggregate per characteristic: latest value, date, 5-year median, min, max, sample count, and a time series (max 500 points) for a sparkline.

### 6.4 Impairments and assessments

| Source | Endpoint | Use |
|---|---|---|
| EPA ATTAINS geospatial service | `https://gispub.epa.gov/arcgis/rest/services/OW/ATTAINS_Assessment/MapServer` (Assessment Areas and Lines layers) | Point or polygon intersect to find the Assessment Unit ids covering this waterbody |
| EPA ATTAINS web services | `https://api.epa.gov/attains/assessments?assessmentUnitIdentifier=…&api_key=…` and `/assessmentUnits` | Use support status per designated use (swimming, fish consumption, aquatic life, drinking water), impairment causes, TMDLs, reporting cycle |

As of May 2026 ATTAINS requires a free api.data.gov key. Read it from `ATTAINS_API_KEY` in the server env and fall back to `DEMO_KEY` with a console warning.

### 6.5 Life (species)

| Source | Endpoint | Use |
|---|---|---|
| GBIF occurrence search | `https://api.gbif.org/v1/occurrence/search` with `geometry=<WKT>`, `hasCoordinate=true`, `occurrenceStatus=PRESENT`, `facet=speciesKey`, `limit=0`, `facetLimit=200`, filtered by taxonKey per group | Species present and record counts. Simplify the polygon (turf `simplify`) until its WKT is under 1,500 characters, or fall back to its bbox. Use counter-clockwise ring order as GBIF expects |
| GBIF species | `https://api.gbif.org/v1/species/{key}` and `/vernacularNames` | Common names, taxonomy |
| USGS Nonindigenous Aquatic Species (NAS) | `https://nas.er.usgs.gov/api/v2/occurrence/search?huc8=…` | Flag invasive or introduced species. HUC8 comes from the NHD record or a WBD point query |
| Bundled species catalog (`shared/species-catalog.json`) | Local | Traits used by the 3D scene: body archetype, length range, colours, preferred depth band, schooling, habitat (benthic, pelagic, littoral), temperature preference, IUCN status where known |

Groups to query (GBIF higher taxon keys; resolve by name via `/v1/species/match` at startup and cache): Actinopterygii (ray-finned fish), Petromyzontiformes (lampreys), Testudines (turtles), Amphibia, Decapoda (crayfish, crabs), Bivalvia (mussels, clams), Gastropoda, Cetacea and Sirenia (for coastal waters), aquatic plants (Nymphaeaceae, Potamogetonaceae, Hydrocharitaceae, Typhaceae), Cyanobacteria.

Bundled catalog scope for v1: about 120 North American freshwater and estuarine species that are common in GBIF records (bass, sunfish, perch, walleye, pike, muskellunge, trout, salmon, catfish, carp, gar, sturgeon, shad, herring, minnows, darters, lamprey, eel, striped bass, crabs, crayfish, zebra and quagga mussels, snapping and painted turtles, bullfrog, and so on). Species not in the catalog render with a generic archetype chosen by taxonomic family, then order, then class.

Catalog entry shape is in section 7.

### 6.6 Source TTLs

| Source | Server cache TTL |
|---|---|
| NHD geometry, HydroLAKES index | 30 days |
| ATTAINS | 7 days |
| WQP results | 24 hours |
| USGS continuous values | 15 minutes |
| GBIF, NAS | 7 days |

## 7. Data model (`shared/src/types.ts`)

```ts
export type SourceStatus = "ok" | "empty" | "error" | "unsupported";

export interface Provenance {
  source: string;            // "USGS NHD", "EPA WQP", ...
  url: string;               // exact request URL, keys redacted
  retrievedAt: string;       // ISO timestamp
  license?: string;
  note?: string;
}

export interface SourceResult<T> {
  status: SourceStatus;
  data: T | null;
  provenance: Provenance;
  error?: string;
}

export type WaterbodyType =
  | "lake" | "reservoir" | "pond" | "river" | "stream"
  | "estuary" | "bay" | "wetland" | "unknown";

export interface WaterbodyIdentity {
  id: string;                          // "nhd:…" | "osm:…"
  name: string | null;
  type: WaterbodyType;
  state?: string;
  country: string;
  huc8?: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox: [number, number, number, number];
  centroid: [number, number];
}

export interface Measured<T = number> {
  value: T;
  unit: string;
  estimated: boolean;
  method?: string;
}

export interface PhysicalProfile {
  areaKm2: Measured;
  perimeterKm: Measured;
  shorelineDevelopment?: Measured;
  surfaceElevationM?: Measured;
  maxDepthM?: Measured;
  meanDepthM?: Measured;
  volumeMcm?: Measured;          // million cubic metres
  lengthKm?: Measured;           // rivers
}

export type ParameterKey =
  | "water_temp" | "dissolved_oxygen" | "ph" | "turbidity" | "secchi_depth"
  | "specific_conductance" | "total_phosphorus" | "total_nitrogen" | "nitrate"
  | "chlorophyll_a" | "microcystins" | "e_coli" | "enterococci"
  | "mercury" | "lead" | "arsenic" | "pfas_total" | "pfos" | "pfoa"
  | "pcbs" | "atrazine" | "chloride" | "salinity";

export interface ParameterSummary {
  key: ParameterKey;
  label: string;
  unit: string;
  latest: { value: number; date: string; stationId: string } | null;
  median5y: number | null;
  min: number | null;
  max: number | null;
  sampleCount: number;
  series: Array<{ t: string; v: number }>;
  threshold?: ThresholdRef;
  status: "good" | "watch" | "exceeds" | "no_reference";
}

export interface ThresholdRef {
  label: string;           // "EPA recreational criterion"
  value: number;
  unit: string;
  direction: "max" | "min" | "range";
  rangeMax?: number;
  citation: string;        // URL
}

export interface ImpairmentProfile {
  assessmentUnits: Array<{ id: string; name: string; cycle: string; url: string }>;
  uses: Array<{ use: string; status: "fully_supporting" | "not_supporting" | "insufficient_info" | "not_assessed" }>;
  causes: Array<{ name: string; group: string; hasTmdl: boolean }>;
}

export interface SpeciesRecord {
  gbifKey: number;
  scientificName: string;
  commonName: string | null;
  group: SpeciesGroup;
  recordCount: number;
  lastObserved?: string;
  introduced: boolean;           // from NAS
  iucn?: "LC" | "NT" | "VU" | "EN" | "CR" | "DD";
  catalogId?: string;            // match in species-catalog.json
}

export type SpeciesGroup =
  | "fish" | "lamprey" | "turtle" | "amphibian" | "crustacean"
  | "mollusc" | "mammal" | "plant" | "cyanobacteria" | "other";

export interface WaterbodyProfile {
  identity: WaterbodyIdentity;
  physical: SourceResult<PhysicalProfile>;
  quality: SourceResult<ParameterSummary[]>;
  impairments: SourceResult<ImpairmentProfile>;
  life: SourceResult<SpeciesRecord[]>;
  stations: SourceResult<Array<{ id: string; name: string; lon: number; lat: number; org: string }>>;
  generatedAt: string;
  demo: boolean;
}

// species-catalog.json entries
export interface CatalogSpecies {
  id: string;                    // "micropterus-salmoides"
  scientificName: string;
  commonName: string;
  archetype: FishArchetype | "turtle" | "crayfish" | "crab" | "mussel" | "frog" | "plant" | "mammal";
  lengthCm: [number, number];    // typical adult range
  colors: { back: string; side: string; belly: string; fin: string; pattern?: "bars" | "spots" | "stripe" | "mottled" | "none" };
  depthBand: "surface" | "littoral" | "midwater" | "benthic";
  schooling: boolean;
  tempPrefC?: [number, number];
  notes?: string;
}

export type FishArchetype =
  | "fusiform"      // trout, salmon, bass
  | "compressed"    // sunfish, crappie, shad
  | "elongate"      // pike, gar, muskellunge
  | "anguilliform"  // eel, lamprey
  | "benthic"       // catfish, sturgeon, carp
  | "small";        // minnows, darters
```

## 8. 3D views

All four scenes are React Three Fiber components under `app/src/scenes/`. Each takes a `SceneModel` built by the pure function `buildSceneModel(profile, catalog)` in `shared/`. That function is unit tested; scenes contain no data fetching.

```ts
export interface SceneModel {
  outline: Array<[number, number]>;       // local metres, centred on centroid, simplified to ≤ 400 vertices
  maxDepthM: number;
  meanDepthM: number;
  depthEstimated: boolean;
  visibilityM: number;                    // heuristic: 1.5 × secchi depth if known, else clamp(8 / (NTU + 0.3), 0.3, 30); default 5 m
  waterTint: string;                      // hex; bluer when clear, green with high chlorophyll, brown with high turbidity
  surfaceTempC?: number;
  thermoclineM?: number;                  // estimate for lakes deeper than 6 m with summer temp data
  doProfile?: Array<{ depthM: number; mgL: number }>;
  actors: Array<{ catalogId: string | null; archetype: string; count: number; depthBand: string; lengthCm: number; colors: CatalogSpecies["colors"]; introduced: boolean; label: string }>;
  pollutants: Array<{ key: ParameterKey; ratio: number; label: string }>; // value / threshold
  demo: boolean;
}
```

### 8.1 View switcher

Views: `map` (default), `raised`, `underwater`, `section`, `pollutants`. The switcher is a segmented control in the Inspector header and also keys 1–5. The active view is in the URL (`?wb=nhd:123&view=underwater`) so links are shareable and reload restores state.

### 8.2 Raised Terrain view

- A diorama: the waterbody plus a 2 km margin of surrounding land, cut out as a block and floating over a dark backdrop, with soil-coloured side walls.
- Land surface: fetch Terrarium DEM tiles covering the block at a zoom that gives about 256 × 256 samples, decode (`elevation = R × 256 + G + B / 256 − 32768`), build a displaced plane.
- Lake bed: synthesise bathymetry. For each grid cell inside the outline, depth = `maxDepth × f(d / dMax)` where `d` is the distance to shore and `f(x) = x^k` with `k` chosen so that the mesh's mean depth matches `meanDepthM` (default `k = 0.7` when mean depth is unknown). Rivers use a parabolic channel cross-section with max depth at the centreline.
- Water: a translucent surface with animated normals and Fresnel, clipped to the outline. A toggle hides the water to reveal the bed.
- Vertical exaggeration slider, 1× to 20×, default auto (so the deepest point is at least 8% of the block width).
- Depth contours drawn on the bed every N metres (N chosen for 5–10 lines).
- Station markers as pins; clicking a pin shows its latest readings.
- OrbitControls with damping; min polar angle so the camera never goes under the block.

### 8.3 Underwater view

- The camera sits inside the water volume, moving slowly on a spline path through the lake with free-look (mouse drag or touch). A "Free swim" toggle enables WASD + mouse.
- Scene extents: a box around a representative 200 m × 200 m patch using the synthesised bed from 8.2 near the deepest point, with the littoral shelf visible on one side.
- Visibility: exponential fog with density from `visibilityM`, colour `waterTint`. Light shafts (god rays) from the surface, weaker with depth. Caustics projected on the bed in shallow water (under 8 m).
- Particles: suspended sediment count scales with turbidity; green algae specks scale with chlorophyll-a.
- Plants: instanced kelp-like or reed-like stalks in the littoral zone if plant species are present.
- Actors
  - Fish are procedural meshes built from archetype parameters (body length-to-depth ratio, taper, fin set, tail shape) and coloured by a small shader using the catalog `colors` and `pattern`. No external model files.
  - Swimming animation in the vertex shader: a travelling sine wave along the body axis, amplitude increasing toward the tail. Anguilliform archetypes use full-body undulation.
  - Movement: boids (separation, alignment, cohesion) for schooling species, wander + obstacle avoidance for solitary ones. Constrain each species to its `depthBand`. Benthic species stay within 1 m of the bed.
  - Counts: `count = clamp(round(4 × log10(recordCount + 1)), 1, 24)` per species, 12 species max on screen, 250 fish total max. Pick the top species by record count; always include at least one introduced species if any exist.
  - Hover or tap a fish to show a label card (common name, scientific name, native or introduced badge, record count). Introduced species get an orange outline on hover.
  - Turtles, crayfish, crabs, mussels, frogs use simple procedural shapes with idle animations (mussels static on the bed, crayfish walking, turtles paddling near the surface).
- Instanced rendering (one `InstancedMesh` per species) so 250 fish stay at 60 fps on a mid-range laptop.

### 8.4 Cross-Section view

- A 2.5D vertical slice through the waterbody along its longest axis, rendered in three.js as a flat panel with slight depth.
- Shows bed profile, water surface, thermocline band (if estimated), a dissolved-oxygen gradient overlay coloured from the DO profile (red below 2 mg/L, amber 2–5, blue above 5).
- Small species icons placed in their depth bands along the slice, sized by record count.
- A depth ruler on the left and distance ruler on the bottom, in metres (toggle to feet).
- When there is no DO profile, show the surface DO value and a clear "no depth profile measured" note in place of the gradient.

### 8.5 Pollutants view

- The raised diorama from 8.2 with the water rendered as a volume of glowing particles.
- One particle system per pollutant in `SceneModel.pollutants`, colour-coded, density proportional to `ratio` (value over threshold) on a log scale, capped.
- A legend lists each pollutant with its latest value, threshold, ratio and date. Pollutants over their threshold pulse slowly.
- ATTAINS impairment causes that have no measured values still appear in the legend as "listed impairment, no recent measurement" with no particles.
- If there are no pollutant measurements, the view shows an empty clear volume and a message saying so. Never invent particles.

### 8.6 Shared scene requirements

- Suspense boundaries with a loading indicator; scenes mount only once `SceneModel` is ready.
- Adaptive quality: use drei `PerformanceMonitor` to drop DPR, particle counts and fish counts when FPS falls below 45.
- Pause rendering (`frameloop="demand"`) when the tab is hidden or the Map view is active.
- A small "Modelled" badge in the corner of any scene whose depth or bathymetry is estimated, and a "Demo data" badge in demo mode.
- WebGL unavailable: show the Inspector panel only with a message.

## 9. Inspector panel content

Header: name (or "Unnamed lake" plus type), type badge, state/country, area, a "Demo data" badge if applicable, close button, view switcher.

Tabs
1. **Overview**: key facts grid (area, max depth, mean depth, volume, elevation, perimeter), a one-paragraph plain-language summary generated from a template (not an LLM) using available facts, top 5 species thumbnails, impairment headline ("Listed as impaired for: mercury, phosphorus" or "No impairments listed" or "Not assessed").
2. **Water Quality**: one card per parameter with latest value, unit, date, sparkline of the series, 5-year median, and a status chip against the threshold. Parameters without data are omitted, with a collapsed "Not measured here" list at the bottom.
3. **Pollutants and Impairments**: designated uses with support status, impairment causes grouped (nutrients, metals, pathogens, organics, other), TMDL flags, links to the ATTAINS assessment unit pages.
4. **Life**: species list grouped by `SpeciesGroup`, sortable by record count or name, filter for introduced only. Each row: common name, scientific name, record count, last observed year, introduced badge, IUCN badge. Clicking a row jumps to the Underwater view and highlights that species.
5. **Sources**: every `Provenance` in a table with source, retrieved time, status, link. A plain note that data comes from third-party monitoring, may be sparse or old, and that screening thresholds are for context only.

Units: metric default, imperial toggle in settings persisted to localStorage (wrapped in try/catch).

## 10. Thresholds (`shared/src/thresholds.ts`)

One table, each entry with a citation URL. These are screening references for colour coding only. The implementer should put these values in with the citations below and add a `// verify` comment on any value they could not confirm.

| Parameter | Reference | Value |
|---|---|---|
| Dissolved oxygen | Common aquatic-life guidance | min 5 mg/L (watch below 5, exceeds below 2) |
| pH | EPA aquatic life criteria range | 6.5 to 9.0 |
| E. coli | EPA 2012 Recreational Water Quality Criteria, geometric mean | 126 CFU/100 mL |
| Enterococci | EPA 2012 RWQC, geometric mean (marine and fresh) | 35 CFU/100 mL |
| Microcystins | EPA 2019 recreational criteria/swimming advisory | 8 µg/L |
| Nitrate (as N) | EPA drinking water MCL | 10 mg/L |
| Arsenic | EPA drinking water MCL | 10 µg/L |
| Mercury (total, water) | EPA drinking water MCL (inorganic) | 2 µg/L |
| Lead | EPA drinking water action level | 15 µg/L (note 2024 LCRI lowers to 10 µg/L on its compliance date) |
| PFOA, PFOS | EPA 2024 NPDWR MCLs | 4.0 ng/L each |
| Chloride | EPA aquatic life chronic criterion | 230 mg/L |
| Total phosphorus, total nitrogen, chlorophyll-a | Vary by ecoregion and state; v1 uses trophic-state bands (Carlson TSI) and shows status "no_reference" against a legal criterion | TSI bands |

Status rule: `good` within threshold, `watch` within 20% of the limit, `exceeds` beyond it, `no_reference` when no row applies.

## 11. Demo mode and fixtures

Demo mode is on by default in development and in the e2e tests (`DEMO_MODE=1` for the server, `VITE_DEMO=1` shows the badge). It is required because the build container cannot reach the data hosts.

Fixture set: six waterbodies chosen to exercise different code paths.

| Waterbody | Why |
|---|---|
| Lake Champlain (VT/NY) | Large, well monitored, phosphorus impairment, lamprey and many fish |
| Lake Tahoe (CA/NV) | Very deep, very clear water, invasive species |
| Crater Lake (OR) | Deepest US lake, few species, almost no pollutants |
| Lake Erie, western basin (OH) | Cyanobacteria blooms, high chlorophyll, microcystins |
| Onondaga Lake (NY) | Legacy mercury and other industrial contamination |
| Potomac River at Washington DC | River geometry path, E. coli, PFAS |

Each fixture is a folder `fixtures/{slug}/` with one JSON file per adapter, in the exact raw shape the upstream API returns, so adapters and normalizers are tested end to end. Geometry should be a simplified but recognisable outline. Values should be realistic in magnitude for that waterbody, but the builder cannot verify them from the container, so every fixture file carries `"_demo": true` and the UI marks all demo data as "Illustrative sample data, not live measurements". Never present fixture values as real.

The map in demo mode shows markers for the six demo waterbodies; clicking anywhere else shows "Live data is off in demo mode".

## 12. Performance budgets

- Initial JS under 400 KB gzipped for the map shell; three.js scenes code-split and loaded on first 3D view.
- Time to interactive map under 2.5 s on a fast connection.
- Profile fan-out p95 under 3 s warm cache, under 8 s cold.
- Underwater scene holds 60 fps with 250 fish on integrated graphics at 1080p, degrades gracefully below that.

## 13. Accessibility

- All panel content reachable by keyboard; view switcher is a proper radiogroup.
- Colour is never the only signal: status chips carry text.
- Each 3D view has a text alternative summary in the panel ("12 species shown; visibility about 4 m; max depth 122 m, modelled").
- Respect `prefers-reduced-motion`: fish swim slower, camera paths stop, particle pulsing disabled.
- Light and dark themes via CSS variables, following system preference.

## 14. Testing

Unit (Vitest)
- Each adapter against its fixture, including error and empty cases.
- Normalizers: unit conversions (mg/L vs µg/L, °F to °C, feet to metres), characteristic name mapping from WQP to `ParameterKey`.
- `buildSceneModel`: visibility, tint, actor counts, pollutant ratios, depth estimation flags.
- Bathymetry synthesis: mean depth of the generated mesh within 10% of target.
- WKT builder: output under 1,500 characters, counter-clockwise, valid.

E2E (Playwright, demo mode)
- Load map, click Lake Champlain marker, Inspector shows name and all five tabs.
- Switch through all five views; each renders a canvas without console errors.
- Deep link `?wb=…&view=underwater` restores state.
- Life tab row click opens Underwater view with that species highlighted.
- Screenshot of each view saved as a test artifact.

## 15. Milestones for the build

1. **Scaffold**: workspaces, Vite app, Hono server, shared package, lint, test runners, README with run instructions.
2. **Types and fixtures**: `shared` types, thresholds, species catalog (at least 60 entries in M2, 120 by M6), six fixture folders.
3. **Server adapters**: all adapters with config-driven URLs, cache, timeout, demo mode, unit tests.
4. **Map and Inspector**: MapLibre with terrain and pitch, hover and select, search, Inspector with all tabs wired to the API.
5. **3D views**: `buildSceneModel`, Raised, Underwater, Cross-Section, Pollutants; view switcher and URL state.
6. **Polish**: performance pass, accessibility, reduced motion, e2e tests, screenshots, full catalog.

Each milestone ends with a green `npm run lint`, `npm run typecheck`, `npm test`, and a commit.

## 16. Open questions for later versions

- Canada and EU coverage (Environment Canada, EEA WISE data) as additional adapters.
- A pre-built national index of waterbody profiles to make first clicks instant.
- Fish consumption advisories (state-level, no single national API).
- Seasonal time slider driving scenes from historical measurements.
