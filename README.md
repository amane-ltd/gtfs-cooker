# GTFS-cooker

**Live Demo**: [https://amane-ltd.github.io/gtfs-cooker/](https://amane-ltd.github.io/gtfs-cooker/)

![](public/favicon.svg)

A browser-based tool that converts GTFS ZIP files into GeoJSON for visualization and analysis in GIS tools such as [Kepler.gl](https://kepler.gl/), [QGIS](https://qgis.org/), and other applications that support GeoJSON. All processing happens entirely on the client side — no data is ever sent to a server.

GTFS（General Transit Feed Specification）の ZIP ファイルから GeoJSON を生成するブラウザ完結型 Web アプリです。出力ファイルは [Kepler.gl](https://kepler.gl/)、[QGIS](https://qgis.org/) などの GIS ツールで可視化・分析に利用できます。データは一切サーバーに送信されません。

## Features

- **Drag & drop** a GTFS ZIP file or load from URL
- **Multiple output layers** — stops, routes, trips (Kepler.gl Trip format), buffers, dissolved areas, convex/concave hulls, stop-to-stop segments
- **Ridership data matching** — join CSV/Excel ridership data with GTFS, with auto-matching and manual reconciliation
- **Map preview** — deck.gl + MapLibre GL JS with 2D/3D toggle
- **GeoJSON export** — download individual layers or all at once
- **GTFS-JP support** — automatic Shift_JIS / UTF-8 detection
- **Bilingual UI** — English / Japanese

## Output Layers

| Layer | Geometry | Description |
|-------|----------|-------------|
| `stops` | Point | All stops with route/trip count properties |
| `lines` | MultiLineString | Routes from shapes.txt (or stop-sequence fallback) |
| `trips` | LineString | Kepler.gl Trip format with timestamps |
| `stops-buffer` | Polygon | Buffer circles around stops |
| `lines-buffer` | Polygon | Buffer around routes |
| `stops-dissolved` | Polygon | Union of all stop buffers |
| `lines-dissolved` | Polygon | Union of all route buffers |
| `envelope` | Polygon | Bounding box |
| `convex` | Polygon | Convex hull of all stops |
| `concave` | Polygon | Concave hull of all stops |
| `segments` | LineString | Stop-to-stop segments with frequency |
| `matching-stops` | Point | Stops sized by ridership |
| `matching-lines` | LineString | Routes sized by ridership |
| `matching-segments` | LineString | Segments sized by ridership |
| `matching-flow` | Arc | Aggregated OD flows |
| `matching-arc` | Arc | Individual OD records |

## How to Use

1. **Load GTFS** — Drag & drop a GTFS ZIP file, or paste a URL
2. **Select layer** — Choose an output layer from the sidebar
3. **Configure** — Adjust layer-specific options (buffer radius, base date for trips, etc.)
4. **Generate** — Click the Generate button to build GeoJSON and preview on the map
5. **Download** — Click the download button to save as GeoJSON

### Ridership Data (Optional)

1. Load a ridership CSV or Excel file via the Ridership Data section
2. The format is auto-detected; column mapping can be adjusted
3. Stop/route reconciliation supports auto-match, manual mapping, or CSV import
4. Execute Join to link ridership data with GTFS
5. Select a `matching-*` layer to visualize the results

## Tech Stack

- [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/) + [React](https://react.dev/)
- [DuckDB-WASM](https://duckdb.org/docs/api/wasm/) — in-browser SQL engine for relational queries
- [Turf.js](https://turfjs.org/) — spatial operations (buffer, union, convex/concave hull)
- [deck.gl](https://deck.gl/) + [MapLibre GL JS](https://maplibre.org/) — map visualization
- [Zustand](https://zustand.docs.pmnd.rs/) — state management
- [JSZip](https://stuk.github.io/jszip/) — ZIP extraction

## Development

```bash
npm install
npm run dev      # Start dev server
npm run build    # Production build
```

## References

- [nagix/gtfs-box](https://github.com/nagix/gtfs-box) — GTFS/GTFS Realtime viewer
- [BlinkTagInc/gtfs-to-geojson](https://github.com/BlinkTagInc/gtfs-to-geojson) — GTFS to GeoJSON conversion
- [Project-LINKS-mlitoss/LINKS-Mobilys](https://github.com/Project-LINKS-mlitoss/LINKS-Mobilys) — Ridership data + GTFS visualization

## License

This project is licensed under the [MIT License](LICENSE).
You are free to use, modify, and distribute this software for any purpose, including commercial use.

本プロジェクトは [MIT ライセンス](LICENSE)の下で公開されています。
商用利用を含め、自由に使用・改変・再配布が可能です。

## Author

[nagampere](https://github.com/nagampere) / [AMANE Ltd.](https://amane.ltd/)
