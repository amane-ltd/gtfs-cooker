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

Review the detected format and, if necessary, adjust column mappings in the "Column Configuration" panel.

<p align="center"><img src="../images/7_INPURFORMAT.png" width="50%"></p>

| Setting | Description | Used by |
|---------|-------------|---------|
| Boarding stop column | Stop name/ID for boarding | Stops, Segments, Flow, Arc |
| Alighting stop column | Stop name/ID for alighting | Segments, Flow, Arc |
| GTFS stop field | Match target (stop_id or stop_name) | — |
| Route column | Route name/ID | Lines |
| GTFS route field | Match target (route_id / route_short_name / route_long_name) | — |
| Agency column | Agency name/ID | — |
| Count columns | Passenger count columns | All layers |

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

Results appear in a mapping table. Unmatched items can be manually assigned by selecting a GTFS entity from the dropdown.

::: tip
Use "Save mapping CSV" to export the current mapping. It can be re-imported later via "Upload mapping CSV".
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

As with other layers, click "Generate" to create the layer, preview it on the map, and download.

## Supported Formats

| Format | Description | Typical source |
|--------|-------------|----------------|
| OD Detail (COMmmmONS) | IC card individual records | COMmmmONS platform |
| OD Detail | Generic OD individual records | Various survey data |
| OD Aggregate | Aggregated data per OD pair | OD surveys |
| Stop Aggregate | Aggregated boarding/alighting per stop | Stop-level surveys |
| Route Aggregate | Aggregated data per route | Route-level surveys |
| Stop × Trip Detail | Detailed data per stop-trip combination | Bus location systems |
