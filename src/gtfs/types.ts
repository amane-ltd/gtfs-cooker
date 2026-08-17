export type MatchingOutputLayer =
  | 'matching-stops' | 'matching-lines' | 'matching-segments'
  | 'matching-flow' | 'matching-od'
  | 'matching-trips' | 'matching-animation' | 'matching-ridership';

export type LayerType =
  | 'stops' | 'lines' | 'animation'
  | 'stops-buffer' | 'lines-buffer'
  | 'stops-dissolved' | 'lines-dissolved'
  | 'envelope' | 'convex' | 'concave'
  | 'segments'
  | 'matching'
  | MatchingOutputLayer;

export interface GtfsSummary {
  agencyNames: string[];
  routeCount: number;
  stopCount: number;
  tripCount: number;
  hasShapes: boolean;
  hasCalendar: boolean;
  hasCalendarDates: boolean;
  loadedFiles: string[];
}

export interface ValidationResult {
  level: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export const GTFS_REQUIRED_FILES = [
  'agency.txt', 'routes.txt', 'trips.txt', 'stop_times.txt',
] as const;

export const GTFS_CONDITIONALLY_REQUIRED_FILES = [
  'stops.txt',
  'calendar.txt', 'calendar_dates.txt',
  'feed_info.txt',
] as const;

export const GTFS_OPTIONAL_FILES = [
  'shapes.txt',
  'fare_attributes.txt', 'fare_rules.txt', 'frequencies.txt',
  'transfers.txt',
  'translations.txt', 'attributions.txt', 'levels.txt', 'pathways.txt',
  'areas.txt', 'stop_areas.txt',
  'networks.txt', 'route_networks.txt',
  'timeframes.txt', 'rider_categories.txt', 'fare_media.txt',
  'fare_products.txt', 'fare_leg_rules.txt', 'fare_leg_join_rules.txt',
  'fare_transfer_rules.txt',
  'location_groups.txt', 'location_group_stops.txt',
  'locations.geojson', 'booking_rules.txt',
] as const;

export const GTFS_JP_FILES = [
  'agency_jp.txt', 'routes_jp.txt', 'office_jp.txt',
] as const;

export const STOPS_DEFAULT_PROPERTIES = [
  'stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon',
  'location_type', 'parent_station', 'platform_code',
  'zone_id', 'wheelchair_boarding', 'stop_url', 'stop_desc',
] as const;

export const STOPS_JOIN_PROPERTIES = [
  'routes', 'agency_name', 'route_count',
  'trip_weekday', 'trip_holiday',
  'trip_morning', 'trip_daytime', 'trip_evening', 'trip_latenight',
  'trip_04', 'trip_05', 'trip_06', 'trip_07', 'trip_08', 'trip_09',
  'trip_10', 'trip_11', 'trip_12', 'trip_13', 'trip_14', 'trip_15',
  'trip_16', 'trip_17', 'trip_18', 'trip_19', 'trip_20', 'trip_21',
  'trip_22', 'trip_23', 'trip_24', 'trip_25', 'trip_26', 'trip_27',
  'travel_time_min', 'travel_time_route_name', 'travel_time_target_stop',
] as const;

export const LINES_DEFAULT_PROPERTIES = [
  'route_id', 'route_short_name', 'route_long_name',
  'route_type', 'route_color', 'route_text_color',
  'route_url', 'route_desc', 'agency_id', 'agency_name',
] as const;

export const LINES_JOIN_PROPERTIES = [
  'trip_weekday', 'trip_holiday',
  'trip_morning', 'trip_daytime', 'trip_evening', 'trip_latenight',
  'trip_04', 'trip_05', 'trip_06', 'trip_07', 'trip_08', 'trip_09',
  'trip_10', 'trip_11', 'trip_12', 'trip_13', 'trip_14', 'trip_15',
  'trip_16', 'trip_17', 'trip_18', 'trip_19', 'trip_20', 'trip_21',
  'trip_22', 'trip_23', 'trip_24', 'trip_25', 'trip_26', 'trip_27',
] as const;

export const ANIMATION_DEFAULT_PROPERTIES = [
  'trip_id', 'route_id', 'service_id',
  'route_short_name', 'route_long_name',
  'route_type', 'route_color',
  'direction_id', 'trip_headsign', 'shape_id',
] as const;

export type StopsDissolvedGroupBy = 'none' | 'agency_name' | 'route_id';
export type LinesDissolvedGroupBy = 'none' | 'agency_id' | 'route_id' | 'shape_id';

/** lines / lines-dissolved の絞り込み対象列。 */
export type LinesFilterColumn = 'route_id' | 'route_short_name' | 'route_long_name';

export const STOPS_DISSOLVED_PROPERTIES = ['agency_name', 'route_id'] as const;
export const LINES_DISSOLVED_PROPERTIES = ['agency_id', 'agency_name', 'route_id', 'route_short_name', 'shape_id'] as const;
export const AREA_PROPERTIES = ['agency_name'] as const;

export const ENVELOPE_PROPERTIES = ['agency_name', 'bbox'] as const;

export const SEGMENTS_PROPERTIES = [
  'from_stop_id', 'from_stop_name', 'from_stop_lat', 'from_stop_lon',
  'to_stop_id', 'to_stop_name', 'to_stop_lat', 'to_stop_lon',
  'route_id', 'route_short_name', 'route_long_name',
  'trip_weekday', 'trip_holiday',
  'trip_morning', 'trip_daytime', 'trip_evening', 'trip_latenight',
  'trip_04', 'trip_05', 'trip_06', 'trip_07', 'trip_08', 'trip_09',
  'trip_10', 'trip_11', 'trip_12', 'trip_13', 'trip_14', 'trip_15',
  'trip_16', 'trip_17', 'trip_18', 'trip_19', 'trip_20', 'trip_21',
  'trip_22', 'trip_23', 'trip_24', 'trip_25', 'trip_26', 'trip_27',
  'distance_m',
] as const;

const RIDERSHIP_HOURLY_PROPERTIES = [
  'ridership_morning', 'ridership_daytime', 'ridership_evening', 'ridership_latenight',
  'ridership_04', 'ridership_05', 'ridership_06', 'ridership_07', 'ridership_08', 'ridership_09',
  'ridership_10', 'ridership_11', 'ridership_12', 'ridership_13', 'ridership_14', 'ridership_15',
  'ridership_16', 'ridership_17', 'ridership_18', 'ridership_19', 'ridership_20', 'ridership_21',
  'ridership_22', 'ridership_23', 'ridership_24', 'ridership_25', 'ridership_26', 'ridership_27',
] as const;

const RIDERSHIP_PER_TRIP_PROPERTIES = [
  'ridership_per_trip',
  'ridership_per_trip_morning', 'ridership_per_trip_daytime', 'ridership_per_trip_evening', 'ridership_per_trip_latenight',
  'ridership_per_trip_04', 'ridership_per_trip_05', 'ridership_per_trip_06', 'ridership_per_trip_07',
  'ridership_per_trip_08', 'ridership_per_trip_09', 'ridership_per_trip_10', 'ridership_per_trip_11',
  'ridership_per_trip_12', 'ridership_per_trip_13', 'ridership_per_trip_14', 'ridership_per_trip_15',
  'ridership_per_trip_16', 'ridership_per_trip_17', 'ridership_per_trip_18', 'ridership_per_trip_19',
  'ridership_per_trip_20', 'ridership_per_trip_21', 'ridership_per_trip_22', 'ridership_per_trip_23',
  'ridership_per_trip_24', 'ridership_per_trip_25', 'ridership_per_trip_26', 'ridership_per_trip_27',
] as const;

export { RIDERSHIP_HOURLY_PROPERTIES, RIDERSHIP_PER_TRIP_PROPERTIES };

export const MATCHING_STOPS_PROPERTIES = [
  'stop_id', 'stop_name', 'ridership_on', 'ridership_off',
  ...RIDERSHIP_HOURLY_PROPERTIES,
  ...RIDERSHIP_PER_TRIP_PROPERTIES,
] as const;

export const MATCHING_LINES_PROPERTIES = [
  'route_id', 'route_short_name', 'route_long_name', 'ridership_count',
  ...RIDERSHIP_HOURLY_PROPERTIES,
  ...RIDERSHIP_PER_TRIP_PROPERTIES,
] as const;

export const MATCHING_SEGMENTS_PROPERTIES = [
  'from_stop_id', 'from_stop_name', 'from_stop_lat', 'from_stop_lon',
  'to_stop_id', 'to_stop_name', 'to_stop_lat', 'to_stop_lon',
  'ridership',
  ...RIDERSHIP_HOURLY_PROPERTIES,
  ...RIDERSHIP_PER_TRIP_PROPERTIES,
] as const;

export const MATCHING_FLOW_PROPERTIES = [
  'boarding_stop_id', 'boarding_stop_name',
  'boarding_lat', 'boarding_lon',
  'alighting_stop_id', 'alighting_stop_name',
  'alighting_lat', 'alighting_lon',
  'ridership',
  ...RIDERSHIP_HOURLY_PROPERTIES,
] as const;

export const MATCHING_OD_PROPERTIES = [
  'boarding_stop_id', 'boarding_stop_name',
  'boarding_lat', 'boarding_lon',
  'alighting_stop_id', 'alighting_stop_name',
  'alighting_lat', 'alighting_lon',
  'passenger_count',
] as const;

// Trips with ridership: 1 feature per (trip, segment), onboard count per segment
export const MATCHING_ANIMATION_PROPERTIES = [
  'trip_id', 'route_id', 'route_short_name', 'route_long_name',
  'direction_id', 'service_id',
  'from_stop_id', 'from_stop_name',
  'to_stop_id', 'to_stop_name',
  'departure_datetime', 'arrival_datetime',  // YYYY-MM-DD HH:MM:SS
  'onboard',                // 区間通過時の乗車中人数
  'boardings_at_from',      // from_stop での乗車人数
  'alightings_at_to',       // to_stop での降車人数
] as const;

// matching-trips: 便×区間の onboard を静的セグメントで表示。
// アニメ用の時刻列に加え、datetime 形式（YYYY-MM-DD HH:MM:SS）の列を持つ。
export const MATCHING_TRIPS_PROPERTIES = [
  'trip_id', 'route_id', 'route_short_name', 'route_long_name',
  'direction_id', 'service_id',
  'from_stop_id', 'from_stop_name',
  'to_stop_id', 'to_stop_name',
  'departure_datetime', 'arrival_datetime',  // YYYY-MM-DD HH:MM:SS
  'onboard',
  'boardings_at_from',
  'alightings_at_to',
] as const;

// Per-ridership-record trajectory (Kepler.gl Trip format)
export const MATCHING_RIDERSHIP_PROPERTIES = [
  'ridership_record_id',
  'trip_id', 'route_id', 'route_short_name', 'route_long_name',
  'boarding_stop_id', 'boarding_stop_name',
  'boarding_datetime',
  'alighting_stop_id', 'alighting_stop_name',
  'alighting_datetime',
  'passenger_count',
  'duration_min',
] as const;

export function getAvailableProperties(layer: LayerType): string[] {
  switch (layer) {
    case 'stops':
    case 'stops-buffer':
      return [...STOPS_DEFAULT_PROPERTIES, ...STOPS_JOIN_PROPERTIES];
    case 'lines':
    case 'lines-buffer':
      return [...LINES_DEFAULT_PROPERTIES, ...LINES_JOIN_PROPERTIES];
    case 'animation':
      return [...ANIMATION_DEFAULT_PROPERTIES];
    case 'stops-dissolved':
      return [...STOPS_DISSOLVED_PROPERTIES];
    case 'lines-dissolved':
      return [...LINES_DISSOLVED_PROPERTIES];
    case 'convex':
    case 'concave':
      return [...AREA_PROPERTIES];
    case 'envelope':
      return [...ENVELOPE_PROPERTIES];
    case 'segments':
      return [...SEGMENTS_PROPERTIES];
    case 'matching-stops':
      return [...MATCHING_STOPS_PROPERTIES];
    case 'matching-lines':
      return [...MATCHING_LINES_PROPERTIES];
    case 'matching-segments':
      return [...MATCHING_SEGMENTS_PROPERTIES];
    case 'matching-flow':
      return [...MATCHING_FLOW_PROPERTIES];
    case 'matching-od':
      return [...MATCHING_OD_PROPERTIES];
    case 'matching-trips':
      return [...MATCHING_TRIPS_PROPERTIES];
    case 'matching-animation':
      return [...MATCHING_ANIMATION_PROPERTIES];
    case 'matching-ridership':
      return [...MATCHING_RIDERSHIP_PROPERTIES];
    case 'matching':
      return [];
  }
}

export function normalizeColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const cleaned = color.replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  return null;
}
