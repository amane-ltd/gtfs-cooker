---
title: File Definitions
---

# File Definitions

## Input: GTFS Files

GTFS-cooker accepts ZIP files conforming to the [GTFS Schedule](https://gtfs.org/schedule/) specification. GTFS-JP (Japan-specific extensions) is also supported.

### Required Files

| File | Description |
|------|-------------|
| agency.txt | Agency information |
| routes.txt | Route information |
| trips.txt | Trip information |
| stop_times.txt | Stop time information |

### Conditionally Required Files

| File | Description |
|------|-------------|
| stops.txt | Stop information |
| calendar.txt | Service patterns (used for weekday/holiday classification) |
| calendar_dates.txt | Service exceptions (additions/removals) |
| feed_info.txt | Feed information |

### Optional Files

| File | Description | Used by |
|------|-------------|---------|
| shapes.txt | Route shape coordinates | Lines, Lines Buffer, Lines Dissolved |
| frequencies.txt | Service frequency | — |
| transfers.txt | Transfer information | — |

::: info
When shapes.txt is not available, the Lines layer estimates route geometry from stop sequences.
:::

### GTFS-JP Extension Files

| File | Description |
|------|-------------|
| agency_jp.txt | Agency info (Japanese extension) |
| routes_jp.txt | Route info (Japanese extension) |
| office_jp.txt | Office information |

---

## Input: Ridership Data

Ridership data formats used with the Matching feature. CSV / TSV / Excel (.xlsx, .xls) files are supported.

### OD Detail (COMmmmONS)

IC card data format exported from the COMmmmONS platform. See [MLIT Public Transport Data Standard (COMmmmONS)](https://www.mlit.go.jp/commmmons/document/005/) for the specification.

| Column | Description |
|--------|-------------|
| ridership_record_id | Record ID |
| payment_at | Payment timestamp (auto-selected as time column for hourly aggregation) |
| boarding_station_name / _code | Boarding stop name / code |
| alighting_station_name / _code | Alighting stop name / code |
| boarding_route_name / boarding_route_id | Route name / ID |
| operating_agency_name / _code | Agency name / code |
| adult_passenger_count (etc.) | Passenger count (per-age-bucket columns are summed) |

### OD Detail (Generic)

A generic OD individual record format. Column mappings are specified manually in "Column Configuration".

| Required column | Description |
|----------------|-------------|
| Boarding stop column | Boarding stop name or ID |
| Alighting stop column | Alighting stop name or ID |
| Count column(s) | Per-row passenger count (multiple columns summed) |
| Route column (optional) | Route name or ID |
| Agency column (optional) | Agency name or ID |
| Time column (optional) | For hourly aggregation |

### OD Aggregate

Data aggregated per OD pair.

| Required column | Description |
|----------------|-------------|
| Boarding stop code/name | Boarding location |
| Alighting stop code/name | Alighting location |
| Count | Total passengers per OD pair |
| Time column (optional) | For hourly aggregation |

### Stop Aggregate

Boarding/alighting counts aggregated per stop.

| Required column | Description |
|----------------|-------------|
| Stop code/name | Stop identifier |
| Boarding count | Number of boardings |
| Alighting count | Number of alightings |
| Time column (optional) | For hourly aggregation |

### Route Aggregate

Data aggregated per route.

| Required column | Description |
|----------------|-------------|
| Route ID/name | Route identifier |
| Count | Total passengers for the route |
| Time column (optional) | For hourly aggregation |

### Stop × Trip Detail

Detailed data per (stop, trip) combination. In-trip stop ordering is derived by sorting on the **time column**.

| Required column | Description |
|----------------|-------------|
| Stop ID/name | Stop identifier |
| Trip ID | Trip identifier |
| Time column | In-trip ordering key and hourly aggregation source (required) |
| Pass-through count | Through passengers at the stop |
| Boarding count | Number of boardings |
| Alighting count | Number of alightings |
| Route column (optional) | Route name or ID |

### Mapping CSV

The mapping CSV format used for reconciliation.

| Column | Description |
|--------|-------------|
| Column 1 | Ridership data value (stop name/ID) |
| Column 2 | GTFS value (stop_id, route_id, etc.) |

- No header row required.
- To map one ridership value to multiple GTFS values, use multiple rows.

---

## Output: GeoJSON Properties

Available properties for each layer. The actual exported properties can be selected in "4. Output Properties".

### Stops Layer (Point)

| Property | Type | Description |
|----------|------|-------------|
| stop_id | string | Stop ID |
| stop_code | string | Stop code |
| stop_name | string | Stop name |
| stop_lat | number | Latitude |
| stop_lon | number | Longitude |
| location_type | number | Location type |
| parent_station | string | Parent station ID |
| platform_code | string | Platform code |
| zone_id | string | Fare zone ID |
| wheelchair_boarding | number | Wheelchair accessibility |
| stop_url | string | Stop URL |
| stop_desc | string | Stop description |
| routes | string[] | List of route IDs passing through |
| agency_name | string | Agency name |
| route_count | number | Number of routes |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trip_morning | number | Morning trips (4:00–8:59) |
| trip_daytime | number | Daytime trips (9:00–16:59) |
| trip_evening | number | Evening trips (17:00–20:59) |
| trip_latenight | number | Late night trips (21:00–27:59) |
| trip_04 – trip_27 | number | Hourly trip counts (weekday) |
| travel_time_min | number | Travel time (minutes) to the target stop |
| travel_time_route_name | string | Route used for travel-time calculation |
| travel_time_target_stop | string | Target stop name |

### Lines Layer (MultiLineString)

| Property | Type | Description |
|----------|------|-------------|
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| route_long_name | string | Route long name |
| route_type | number | Route type |
| route_color | string | Route color (#RRGGBB) |
| route_text_color | string | Text color |
| route_url | string | Route URL |
| route_desc | string | Route description |
| agency_id | string | Agency ID |
| agency_name | string | Agency name |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trip_morning – trip_latenight | number | Trips by time period |
| trip_04 – trip_27 | number | Hourly trip counts |

### Trips Layer (LineString, Kepler.gl Trip format)

| Property | Type | Description |
|----------|------|-------------|
| trip_id | string | Trip ID |
| route_id | string | Route ID |
| service_id | string | Service ID |
| route_short_name | string | Route short name |
| route_long_name | string | Route long name |
| route_type | number | Route type |
| route_color | string | Route color |
| direction_id | number | Direction ID |
| trip_headsign | string | Trip headsign |
| shape_id | string | Shape ID |

### Segments Layer (LineString)

| Property | Type | Description |
|----------|------|-------------|
| from_stop_id | string | Origin stop ID |
| from_stop_name | string | Origin stop name |
| from_stop_lat | number | Origin stop latitude |
| from_stop_lon | number | Origin stop longitude |
| to_stop_id | string | Destination stop ID |
| to_stop_name | string | Destination stop name |
| to_stop_lat | number | Destination stop latitude |
| to_stop_lon | number | Destination stop longitude |
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trip_morning – trip_latenight | number | Trips by time period |
| trip_04 – trip_27 | number | Hourly trip counts |
| distance_m | number | Segment distance (meters) |

### Stops Dissolved / Lines Dissolved (Polygon)

| Property | Type | Description |
|----------|------|-------------|
| agency_name | string | Agency name (grouping key) |
| route_id | string | Route ID (grouping key) |
| route_short_name | string | Route short name (Lines Dissolved only) |
| agency_id | string | Agency ID (Lines Dissolved only) |
| shape_id | string | Shape ID (Lines Dissolved only) |

### Envelope / Convex / Concave (Polygon)

| Property | Type | Description |
|----------|------|-------------|
| agency_name | string | Agency name |
| bbox | number[] | Bounding box coordinates (Envelope only) |

### Matching Stops Layer (Point)

| Property | Type | Description |
|----------|------|-------------|
| stop_id | string | Stop ID |
| stop_name | string | Stop name |
| ridership_on | number | Total boarding count |
| ridership_off | number | Total alighting count |
| ridership_morning – ridership_latenight | number | Period boarding+alighting counts (when time column is set) |
| ridership_04 – ridership_27 | number | Hourly boarding+alighting counts (when time column is set) |
| ridership_per_trip | number | Ridership per trip (when the checkbox is on) |
| ridership_per_trip_morning – ridership_per_trip_latenight | number | Period ridership/trip ratios |
| ridership_per_trip_04 – ridership_per_trip_27 | number | Hourly ridership/trip ratios |

::: info
`ridership_*` is emitted alongside the corresponding `trip_*` properties on each feature. matching-stops also inherits all GTFS Stops layer properties (trip_weekday, etc.).
:::

### Matching Lines Layer (MultiLineString)

| Property | Type | Description |
|----------|------|-------------|
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| route_long_name | string | Route long name |
| ridership_count | number | Total ridership for the route |
| ridership_morning – ridership_latenight | number | Period ridership (when time column is set) |
| ridership_04 – ridership_27 | number | Hourly ridership (when time column is set) |
| ridership_per_trip | number | Ridership per trip (when the checkbox is on) |
| ridership_per_trip_morning – ridership_per_trip_latenight | number | Period ridership/trip ratios |
| ridership_per_trip_04 – ridership_per_trip_27 | number | Hourly ridership/trip ratios |

### Matching Segments Layer (LineString)

| Property | Type | Description |
|----------|------|-------------|
| from_stop_id | string | Origin stop ID |
| from_stop_name | string | Origin stop name |
| from_stop_lat | number | Origin stop latitude |
| from_stop_lon | number | Origin stop longitude |
| to_stop_id | string | Destination stop ID |
| to_stop_name | string | Destination stop name |
| to_stop_lat | number | Destination stop latitude |
| to_stop_lon | number | Destination stop longitude |
| ridership | number | Pass-through ridership for the segment |
| ridership_morning – ridership_latenight | number | Period pass-through ridership |
| ridership_04 – ridership_27 | number | Hourly pass-through ridership |
| ridership_per_trip | number | Pass-through ridership per trip (when the checkbox is on) |
| ridership_per_trip_morning – ridership_per_trip_latenight | number | Period pass-through/trip ratios |
| ridership_per_trip_04 – ridership_per_trip_27 | number | Hourly pass-through/trip ratios |

### Matching Flow Layer (Arc, aggregated OD)

| Property | Type | Description |
|----------|------|-------------|
| boarding_stop_id | string | Boarding stop ID |
| boarding_stop_name | string | Boarding stop name |
| boarding_lat | number | Boarding stop latitude |
| boarding_lon | number | Boarding stop longitude |
| alighting_stop_id | string | Alighting stop ID |
| alighting_stop_name | string | Alighting stop name |
| alighting_lat | number | Alighting stop latitude |
| alighting_lon | number | Alighting stop longitude |
| ridership | number | Aggregated passenger count per OD pair |
| ridership_morning – ridership_latenight | number | Period OD-pair passenger counts |
| ridership_04 – ridership_27 | number | Hourly OD-pair passenger counts |

### Matching OD Layer (Arc, individual records)

| Property | Type | Description |
|----------|------|-------------|
| boarding_stop_id | string | Boarding stop ID |
| boarding_stop_name | string | Boarding stop name |
| boarding_lat | number | Boarding stop latitude |
| boarding_lon | number | Boarding stop longitude |
| alighting_stop_id | string | Alighting stop ID |
| alighting_stop_name | string | Alighting stop name |
| alighting_lat | number | Alighting stop latitude |
| alighting_lon | number | Alighting stop longitude |
| passenger_count | number | Passenger count per record |
