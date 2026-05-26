---
title: Overview
---

::: tip Language / 言語
[日本語版はこちら](/ja/)
:::

# GTFS-cooker

![GTFS-cooker](../images/favicon.svg)

GTFS-cooker is a browser-based web app that converts GTFS (General Transit Feed Specification) ZIP files into GeoJSON for GIS visualization.

## Features

- **Fully client-side processing** — Uploaded data is never sent to a server. Everything is processed in the browser.
- **Multiple output layers** — Generate 12+ layer types: stops, lines, trips, buffers, dissolved areas, convex/concave hulls, segments, and more.
- **Ridership data matching** — Join CSV / Excel ridership data with GTFS to create visualization layers by stop, route, segment, or OD flow.
- **Multiple export formats** — Download as GeoJSON, CSV, or XLSX.
- **Map preview** — Preview generated results on the fly with deck.gl + MapLibre GL JS.
- **Bilingual UI** — Switch between English and Japanese.

## Tech Stack

| Area | Technology |
|------|-----------|
| Framework | Vite + React + TypeScript |
| Data Processing | DuckDB-WASM |
| Spatial Operations | Turf.js |
| ZIP Extraction | JSZip |
| Map Rendering | deck.gl + MapLibre GL JS |
| State Management | Zustand |

## Links

- [Open App](https://amane-ltd.github.io/gtfs-cooker/)
- [GitHub Repository](https://github.com/amane-ltd/gtfs-cooker)
