---
title: Matching (Ridership)
---

# Matching (Ridership)

<p align="center"><img src="../images/matching-flow.png" width="50%"></p>

The Matching feature joins ridership data (CSV / Excel) with GTFS data to generate visualization layers by stop, route, segment, or OD flow.

### Why join ridership data?

GTFS data alone provides route geometries and timetables, but it cannot tell you which stops are heavily used or where passenger demand is concentrated. By joining ridership data, you can:

- **Understand stop-level usage** — Visualize boarding and alighting counts per stop to assess each stop's importance.
- **Analyze route and segment demand** — Compare ridership across routes and segments to identify high- and low-demand areas.
- **Visualize OD flows** — Aggregate origin-destination pairs and display travel patterns as arcs on the map.
- **Support planning decisions** — Identify underutilized segments or peak-hour imbalances to inform route restructuring and schedule adjustments.

## Overview

```
Load ridership file → Format detection → Column config → Reconciliation → Execute join → Generate layer
```

## Steps

### Step 1: Select the Matching Layer

From the "3. Output Layer" dropdown, select **Matching — Ridership data overlay**. This reveals the "5. Ridership Data" section in the sidebar.

### Step 2: Load a Ridership File

Drag & drop or select a CSV / Excel / TSV file.

<p align="center"><img src="../images/6_ridershipdata.png" width="50%"></p>

- For Excel files with multiple sheets, a sheet selector dropdown appears.
- The format is auto-detected from column headers. You can override the detection if needed.

### Step 3: Format and Column Configuration

Review the detected format and, if necessary, adjust column mappings in the "Column Configuration" panel. The visible fields and required mappings depend on the format.

<p align="center"><img src="../images/7_INPURFORMAT.png" width="50%"></p>

#### Available column settings

| Setting | Description | Affects sub-layers |
|---------|-------------|--------------------|
| Boarding stop column | Stop name/ID for boarding | matching-stops, matching-segments, matching-flow, matching-od |
| Alighting stop column | Stop name/ID for alighting | matching-segments, matching-flow, matching-od |
| GTFS stop field | Match target (`stop_id` / `stop_name`) | all stop-based layers |
| Route column | Route name/ID | matching-lines, route filter |
| GTFS route field | Match target (`route_id` / `route_short_name` / `route_long_name`) | matching-lines |
| Agency column | Agency name/ID | (not used in aggregation yet) |
| GTFS agency field | Match target (`agency_id` / `agency_name`) | (same) |
| Boarding count / Alighting count | Separate boarding / alighting counts (`count_on` / `count_off`) | stop's `ridership_on` / `ridership_off` |
| Count columns (multi) | Per-row sum of selected columns becomes the row's ridership | all ridership values |
| Trip ID column | Trip ID for per-trip pass-through accounting | matching-segments (trip-detail path) |
| Pass-through count | Pass-through passenger count at the stop | matching-segments (trip-detail path) |
| Time column | Time column for hourly aggregation. **Required for Stop × Trip Detail**, where it doubles as the in-trip ordering key. Auto-detected at load time from common column names (`payment_at`, `datetime`, `時刻`, `発車時刻`, ...). | all layers' `ridership_*` and period columns |

When the time column is set, the hour is extracted from formats such as `HH:MM:SS`, `YYYY-MM-DD HH:MM:SS`, ISO 8601, or a plain integer hour, exposing `ridership_morning`–`ridership_latenight` and `ridership_04`–`ridership_27` columns. The buckets mirror the GTFS `trip_XX` definitions (morning 4–8 / daytime 9–16 / evening 17–20 / latenight 21–27).

#### Per-format configuration

##### OD Detail (COMmmmONS) / OD Detail

Individual records where each row represents one rider's full journey (boarding + alighting).

::: tip Reference
For the COMmmmONS data specification, see MLIT's [Public Transport Data Standard (COMmmmONS)](https://www.mlit.go.jp/commmmons/document/005/).
:::

| Required | Setting | Typical column |
|----------|---------|----------------|
| ✅ | Boarding stop | `boarding_station_name` / `boarding_station_code` |
| ✅ | Alighting stop | `alighting_station_name` / `alighting_station_code` |
| ✅ | Count columns | `adult_passenger_count` and other passenger-category columns |
| Optional | Route | `boarding_route_name` / `boarding_route_id` |
| Optional | Agency | `operating_agency_name` / `operating_agency_code` |
| Optional | Time | `payment_at` (timestamp) |

→ Sub-layers: matching-stops, matching-lines, matching-segments, matching-flow, matching-od

##### OD Aggregate

One row per OD pair with a count.

| Required | Setting | Typical column |
|----------|---------|----------------|
| ✅ | Boarding stop | `boarding_station_name` / `boarding_station_code` |
| ✅ | Alighting stop | `alighting_station_name` / `alighting_station_code` |
| ✅ | Count | `count` |
| Optional | Route / Agency | — |
| Optional | Time | `hour` / `time_band` |

→ Sub-layers: matching-stops, matching-segments, matching-flow, matching-od (and matching-lines if a route column is set)

##### Stop Aggregate

Boarding and alighting counts per stop. No alighting destination, so OD-style layers are unavailable.

| Required | Setting | Typical column |
|----------|---------|----------------|
| ✅ | Boarding stop | `station_name` / `station_code` |
| ✅ | Boarding count | `count_on` |
| ✅ | Alighting count | `count_off` |
| Optional | Time | `hour` / `time_band` |

→ Sub-layers: matching-stops only

##### Route Aggregate

One row per route (system). No stop info, so stop / segment / OD layers cannot be generated.

| Required | Setting | Typical column |
|----------|---------|----------------|
| ✅ | Route | `boarding_route_name` / `route_name` / `route_id` |
| ✅ | Count | `count` |
| Optional | Agency / Time | — |

→ Sub-layers: matching-lines only

##### Stop × Trip Detail

Per-(stop, trip) rows with boardings, alightings, and pass-through. The alighting-stop column is replaced by **trip ID + time column + pass-through count**: stops within a trip are ordered chronologically by time to derive segment-level pass-through.

| Required | Setting | Typical column |
|----------|---------|----------------|
| ✅ | Boarding stop | `停留所名` / `停留所ID` |
| ✅ | Boarding count | `乗車人数` |
| ✅ | Alighting count | `降車人数` |
| ✅ | Trip ID | `便ID` |
| ✅ | Pass-through count | `通過人数` |
| ✅ | Time column | `時刻` / `発車時刻` / `datetime` |
| Optional | Route | `路線名` / `路線ID` |

The time column is auto-detected at load time and is required for this format — it serves both as the in-trip ordering key and as the input for hourly aggregation (`ridership_morning` through `ridership_27`).

→ Sub-layers: matching-stops, matching-segments (trip-detail path); matching-lines if a route column is set

### Step 3.5: Additional Options

Below the sub-layer selector:

- **Route filter** (optional) — Enter a substring that matches `route_id`, `route_short_name`, or `route_long_name`. matching-stops keeps only stops served by matching routes; matching-lines and matching-segments keep only features whose properties match.
- **Add ridership / trip columns** (checkbox) — Adds `ridership_per_trip` and per-bucket variants (`ridership_per_trip_04`–`ridership_per_trip_27`, `ridership_per_trip_morning`–`ridership_per_trip_latenight`). The denominator uses the `trip_weekday + trip_holiday` totals already on each feature, and per-bucket ratios use the matching `trip_XX` column. Columns are omitted when the denominator is zero.

### Step 4: Select a Sub-layer

Available sub-layers depend on the column configuration:

<p align="center"><img src="../images/8_SUBLAYER.png" width="50%"></p>

| Sub-layer | Required columns |
|-----------|-----------------|
| Matching Stops | Boarding stop |
| Matching Lines | Route |
| Matching Segments | Boarding stop + Alighting stop |
| Matching Flow | Boarding stop + Alighting stop |
| Matching OD | Boarding stop + Alighting stop |

### Step 5: Reconciliation

Map ridership entity names/IDs to GTFS entities. Three modes are available:

<p align="center"><img src="../images/9_RECONCILIATIONMODE.png" width="50%"></p>

#### Direct (IDs Match)

Use when ridership IDs directly correspond to GTFS IDs. No additional mapping required.

#### Auto-match

The algorithm automatically reconciles names. Matching priority:

1. **Exact ID match** — ridership value matches GTFS ID exactly
2. **Exact name match** — ridership value matches GTFS name exactly
3. **Normalized match** — match after katakana/hiragana conversion and whitespace removal
4. **Partial match** — one value contains the other

Results appear in a mapping table, with each row's status column showing `exact-id` / `exact-name` / `normalized` / `partial` / `unmatched`.

##### Manually fixing the mapping

Rows that ended up as **`unmatched`**, or rows where the auto-match picked the wrong target, can be corrected manually by selecting a different candidate from the GTFS-side dropdown.

- The dropdown shows GTFS entities that are not yet assigned to another row (duplicates are filtered out automatically).
- Picking a candidate switches the status to `manual`, and the row is then included in the join.
- Selecting the blank option (`—`) switches the status to `skipped`, removing the row from aggregation.
- The same dropdown is used to override a wrong auto-match — just choose another candidate.

After editing, click **Execute Join** again to re-aggregate using the new `manual` mappings.

::: tip
Use **Save mapping CSV** to export the current mapping (auto-match + manual fixes combined). It can be re-imported later via **Upload mapping CSV**.
:::

#### Upload Mapping CSV

Upload a pre-built mapping CSV file.

- **Format**: Column 1 = ridership value, Column 2 = GTFS value
- No header row required
- Multiple GTFS values can map to one ridership value (use multiple rows)

### Step 6: Execute Join

Click "Execute Join" to join the data based on the reconciliation results.

<p align="center"><img src="../images/10_EXECUTEJOIN.png" width="50%"></p>

Join statistics are displayed:

- **Matched / Unmatched** — Number of records that were/were not successfully joined
- **Stop coverage** — Percentage of GTFS stops matched by ridership data
- **Route coverage** — Percentage of GTFS routes matched by ridership data

### Step 7: Generate and Download

As with other layers, click "Generate" to create the layer, preview it on the map, and download. Each sub-layer differs in what it outputs and how it is visualized.

#### Matching Stops (Point)

Visualizes ridership per stop.

<p align="center"><img src="../images/matching-stops.png" width="50%"></p>

- **Geometry**: Point (same location as GTFS Stops)
- **Circle size**: `√(ridership_on + ridership_off) × 20` — busier stops appear larger.
- **Key properties**:
  - All GTFS Stops layer properties (`stop_id`, `stop_name`, `routes`, `trip_weekday`, `trip_morning`–`trip_27`, ...)
  - `ridership_on` (total boardings), `ridership_off` (total alightings)
  - When time column is set: `ridership_morning`–`ridership_latenight`, `ridership_04`–`ridership_27`
  - With **Add ridership / trip columns** on: `ridership_per_trip` and per-period / per-hour `ridership_per_trip_*`
- **Use cases**: hub identification, stop-level demand analysis, detecting stops with peaked time-of-day usage.

#### Matching Lines (MultiLineString)

Visualizes ridership per route.

<p align="center"><img src="../images/matching-lines.png" width="50%"></p>

- **Geometry**: MultiLineString (same shape as GTFS Lines)
- **Line width**: `√(ridership_count) × 1.5` — busier routes appear thicker.
- **Key properties**: `route_id` / `route_short_name` / `route_long_name` / `ridership_count` plus per-period `ridership_*` and `ridership_per_trip_*`.
- **Use cases**: cross-route demand comparison, identifying congested routes, time-of-day usage pattern analysis.

#### Matching Segments (LineString)

Visualizes pass-through ridership for adjacent-stop segments.

<p align="center"><img src="../images/matching-segments.png" width="50%"></p>

- **Geometry**: LineString (stop-to-stop or matching GTFS Segments shape)
- **Line width**: `√(ridership) × 1.5` — busier segments appear thicker.
- **Key properties**:
  - `from_stop_id` / `from_stop_name` / `from_stop_lat` / `from_stop_lon`
  - `to_stop_id` / `to_stop_name` / `to_stop_lat` / `to_stop_lon`
  - `ridership` (segment pass-through count)
  - When time column is set: `ridership_morning`–`ridership_27`
  - With ratio checkbox on: `ridership_per_trip_*`
- **Use cases**: within-route congestion analysis, bottleneck detection, time-of-day segment demand variation.

#### Matching Flow (Arc, aggregated OD)

Visualizes aggregated origin → destination flows as arcs.

<p align="center"><img src="../images/matching-flow.png" width="50%"></p>

- **Geometry**: LineString (arc endpoints)
- **Line width**: `√(ridership) × 2` — higher-flow OD pairs appear thicker.
- **Key properties**:
  - `boarding_stop_id` / `boarding_stop_name` / `boarding_lat` / `boarding_lon`
  - `alighting_stop_id` / `alighting_stop_name` / `alighting_lat` / `alighting_lon`
  - `ridership` (per OD pair)
  - When time column is set: `ridership_morning`–`ridership_27`
- **Use cases**: dominant OD pattern identification, hub-and-spoke detection, journey-flow mapping.

#### Matching OD (Arc, individual records)

Renders one arc per OD record (not aggregated).

<p align="center"><img src="../images/matching-od.png" width="50%"></p>

- **Geometry**: LineString
- **Line width**: fixed (thin)
- **Key properties**:
  - `boarding_stop_id` / `boarding_stop_name` / `boarding_lat` / `boarding_lon`
  - `alighting_stop_id` / `alighting_stop_name` / `alighting_lat` / `alighting_lon`
  - `passenger_count` (per record)
- **Use cases**: record-level analysis, downstream BI tooling, validating OD patterns at the individual level.

::: tip
Download as GeoJSON / CSV / Excel (.xlsx). CSV and XLSX include `_longitude` / `_latitude` columns in place of the geometry for point layers (e.g. matching-stops).
:::

## Supported Formats

| Format | Description | Typical source |
|--------|-------------|----------------|
| OD Detail (COMmmmONS) | IC card individual records | COMmmmONS platform |
| OD Detail | Generic OD individual records | Various survey data |
| OD Aggregate | Aggregated data per OD pair | OD surveys |
| Stop Aggregate | Aggregated boarding/alighting per stop | Stop-level surveys |
| Route Aggregate | Aggregated data per route | Route-level surveys |
| Stop × Trip Detail | Detailed data per stop-trip combination | Bus location systems |
