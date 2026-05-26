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

IC card data format exported from the COMmmmONS platform.

| Column | Description |
|--------|-------------|
| ridership_record_id | Record ID |
| payment_at | Payment timestamp |
| boarding_station_name | Boarding stop name |
| alighting_station_name | Alighting stop name |
| route_name | Route name |
| agency_name | Agency name |
| passenger_count (etc.) | Passenger count |

### OD Detail (Generic)

A generic OD individual record format. Column mappings are specified manually in "Column Configuration".

| Required column | Description |
|----------------|-------------|
| Boarding stop column | Boarding stop name or ID |
| Alighting stop column | Alighting stop name or ID |
| Route column (optional) | Route name or ID |
| Agency column (optional) | Agency name or ID |

### OD Aggregate

Data aggregated per OD pair.

| Required column | Description |
|----------------|-------------|
| Boarding stop code/name | Boarding location |
| Alighting stop code/name | Alighting location |
| Count | Total passengers per OD pair |

### Stop Aggregate

Boarding/alighting counts aggregated per stop.

| Required column | Description |
|----------------|-------------|
| Stop code/name | Stop identifier |
| Boarding count | Number of boardings |
| Alighting count | Number of alightings |

### Route Aggregate

Data aggregated per route.

| Required column | Description |
|----------------|-------------|
| Route ID/name | Route identifier |
| Count | Total passengers for the route |

### Stop × Trip Detail

Detailed data per stop-trip combination.

| Required column | Description |
|----------------|-------------|
| Stop ID/name | Stop identifier |
| Trip ID | Trip identifier |
| Stop sequence | Stop order within the trip |
| Boarding count | Number of boardings |
| Alighting count | Number of alightings |
| Pass-through count (optional) | Number of through passengers |

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

### Stops Layer

| Property | Type | Description |
|----------|------|-------------|
| stop_id | string | Stop ID |
| stop_code | string | Stop code |
| stop_name | string | Stop name |
| stop_lat | number | Latitude |
| stop_lon | number | Longitude |
| location_type | number | Location type |
| parent_station | string | Parent station ID |
| routes | string[] | List of route IDs passing through |
| agency_name | string | Agency name |
| route_count | number | Number of routes |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trips_morning | number | Morning trips (4:00–8:59) |
| trips_daytime | number | Daytime trips (9:00–16:59) |
| trips_evening | number | Evening trips (17:00–20:59) |
| trips_latenight | number | Late night trips (21:00–27:59) |
| trips_04 – trips_27 | number | Hourly trip counts (weekday) |

### Lines Layer

| Property | Type | Description |
|----------|------|-------------|
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| route_long_name | string | Route long name |
| route_type | number | Route type |
| route_color | string | Route color (#RRGGBB) |
| route_text_color | string | Text color |
| agency_id | string | Agency ID |
| agency_name | string | Agency name |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trips_morning – trips_latenight | number | Trips by time period |
| trips_04 – trips_27 | number | Hourly trip counts |

### Segments Layer

| Property | Type | Description |
|----------|------|-------------|
| from_stop_id | string | Origin stop ID |
| from_stop_name | string | Origin stop name |
| to_stop_id | string | Destination stop ID |
| to_stop_name | string | Destination stop name |
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| trip_weekday | number | Weekday trip count |
| trip_holiday | number | Holiday trip count |
| trips_morning – trips_latenight | number | Trips by time period |
| trips_04 – trips_27 | number | Hourly trip counts |
| distance_m | number | Segment distance (meters) |

### Matching Stops Layer

| Property | Type | Description |
|----------|------|-------------|
| stop_id | string | Stop ID |
| stop_name | string | Stop name |
| ridership_on | number | Boarding count |
| ridership_off | number | Alighting count |

### Matching Lines Layer

| Property | Type | Description |
|----------|------|-------------|
| route_id | string | Route ID |
| route_short_name | string | Route short name |
| route_long_name | string | Route long name |
| ridership_count | number | Ridership count |

### Matching Flow Layer

| Property | Type | Description |
|----------|------|-------------|
| boarding_stop_id | string | Boarding stop ID |
| boarding_stop_name | string | Boarding stop name |
| alighting_stop_id | string | Alighting stop ID |
| alighting_stop_name | string | Alighting stop name |
| ridership | number | Passenger count (aggregated) |
