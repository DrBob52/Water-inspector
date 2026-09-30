# Water Inspector

A browser app built around a 3D map. Click a lake, river, reservoir, bay or pond and the app shows
hydrography, water quality, impairment and biodiversity data for it, then lets you switch between
four data-driven 3D scenes: raised terrain diorama, underwater view, water-column cross-section and
pollutant view. See [SPEC.md](SPEC.md) for the full product and technical spec.

## Layout

```
app/       Vite + React 19 + Tailwind client (MapLibre map, Inspector panel, R3F scenes)
server/    Hono proxy, one adapter per upstream source, cache, demo mode
shared/    Types, thresholds, units, species catalog, scene model, bathymetry synthesis
fixtures/  Demo-mode sample data (every file carries "_demo": true)
e2e/       Playwright end-to-end tests (run in demo mode)
```

## Requirements

Node 22+ and npm 10+.

## Run locally

```bash
npm install

# Development: API server on :8787 (demo mode) and Vite on :5173
npm run dev
# open http://localhost:5173

# Or: build the client and serve everything from one origin on :8787 (demo mode)
npm run start:demo
# open http://localhost:8787
```

Demo mode (`DEMO_MODE=1` for the server, `VITE_DEMO=1` for the client) reads bundled fixtures
instead of the network. All demo data is illustrative sample data, not live measurements.

Environment variables

| Variable             | Where  | Meaning                                                                      |
| -------------------- | ------ | ---------------------------------------------------------------------------- |
| `DEMO_MODE`          | server | `1` reads `/fixtures` instead of calling upstream APIs                       |
| `PORT`               | server | Listen port, default 8787                                                    |
| `ATTAINS_API_KEY`    | server | Free api.data.gov key for EPA ATTAINS (falls back to `DEMO_KEY` with a warn) |
| `CACHE_DIR`          | server | Optional on-disk JSON cache directory (default `server/.cache`, live only)   |
| `VITE_DEMO`          | app    | `1` shows the demo badge                                                     |
| `VITE_OFFLINE_TILES` | app    | `1` swaps the basemap and DEM for a minimal local style (no tile requests)   |
| `VITE_MAP_STYLE_URL` | app    | Override the basemap style URL                                               |
| `VITE_DEM_URL`       | app    | Override the Terrarium DEM tile URL template                                 |

## Scripts

```bash
npm run lint        # ESLint + Prettier check
npm run typecheck   # tsc in every workspace
npm test            # Vitest unit tests in every workspace
npm run test:e2e    # Playwright e2e in demo mode (Chromium from PLAYWRIGHT_BROWSERS_PATH)
npm run fixtures    # regenerate fixtures/ from scripts/generate-fixtures.ts
```

## Status

Work in progress; see the bottom of this file as milestones land.
