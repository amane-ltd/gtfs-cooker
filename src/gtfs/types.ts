export type MatchingOutputLayer =
  | 'matching-stops' | 'matching-lines' | 'matching-segments'
  | 'matching-flow' | 'matching-arc';

export type LayerType =
  | 'stops' | 'lines' | 'trips'
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
  'trips_04', 'trips_05', 'trips_06', 'trips_07', 'trips_08', 'trips_09',
  'trips_10', 'trips_11', 'trips_12', 'trips_13', 'trips_14', 'trips_15',
  'trips_16', 'trips_17', 'trips_18', 'trips_19', 'trips_20', 'trips_21',
  'trips_22', 'trips_23', 'trips_24', 'trips_25', 'trips_26', 'trips_27',
  'trips_morning', 'trips_daytime', 'trips_evening', 'trips_latenight',
] as const;

export const LINES_DEFAULT_PROPERTIES = [
  'route_id', 'route_short_name', 'route_long_name',
  'route_type', 'route_color', 'route_text_color',
  'route_url', 'route_desc', 'agency_id', 'agency_name',
] as const;

export const LINES_JOIN_PROPERTIES = [
  'trip_weekday', 'trip_holiday',
  'trips_04', 'trips_05', 'trips_06', 'trips_07', 'trips_08', 'trips_09',
  'trips_10', 'trips_11', 'trips_12', 'trips_13', 'trips_14', 'trips_15',
  'trips_16', 'trips_17', 'trips_18', 'trips_19', 'trips_20', 'trips_21',
  'trips_22', 'trips_23', 'trips_24', 'trips_25', 'trips_26', 'trips_27',
  'trips_morning', 'trips_daytime', 'trips_evening', 'trips_latenight',
] as const;

export const TRIPS_DEFAULT_PROPERTIES = [
  'trip_id', 'route_id', 'service_id',
  'route_short_name', 'route_long_name',
  'route_type', 'route_color',
  'direction_id', 'trip_headsign', 'shape_id',
] as const;

export type StopsDissolvedGroupBy = 'none' | 'agency_name' | 'route_id';
export type LinesDissolvedGroupBy = 'none' | 'agency_id' | 'route_id' | 'shape_id';

export const STOPS_DISSOLVED_PROPERTIES = ['agency_name', 'route_id'] as const;
export const LINES_DISSOLVED_PROPERTIES = ['agency_id', 'agency_name', 'route_id', 'route_short_name', 'shape_id'] as const;
export const AREA_PROPERTIES = ['agency_name'] as const;

export const ENVELOPE_PROPERTIES = ['agency_name', 'bbox'] as const;

export const SEGMENTS_PROPERTIES = [
  'from_stop_id', 'from_stop_name',
  'to_stop_id', 'to_stop_name',
  'route_id', 'route_short_name',
  'trip_weekday', 'trip_holiday',
  'trips_04', 'trips_05', 'trips_06', 'trips_07', 'trips_08', 'trips_09',
  'trips_10', 'trips_11', 'trips_12', 'trips_13', 'trips_14', 'trips_15',
  'trips_16', 'trips_17', 'trips_18', 'trips_19', 'trips_20', 'trips_21',
  'trips_22', 'trips_23', 'trips_24', 'trips_25', 'trips_26', 'trips_27',
  'trips_morning', 'trips_daytime', 'trips_evening', 'trips_latenight',
  'distance_m',
] as const;

export const MATCHING_STOPS_PROPERTIES = [
  'stop_id', 'stop_name', 'ridership_on', 'ridership_off',
] as const;

export const MATCHING_LINES_PROPERTIES = [
  'route_id', 'route_short_name', 'route_long_name', 'ridership_count',
] as const;

export const MATCHING_SEGMENTS_PROPERTIES = [
  'from_stop_id', 'from_stop_name',
  'to_stop_id', 'to_stop_name',
  'ridership',
] as const;

export const MATCHING_FLOW_PROPERTIES = [
  'boarding_stop_id', 'boarding_stop_name',
  'boarding_lat', 'boarding_lon',
  'alighting_stop_id', 'alighting_stop_name',
  'alighting_lat', 'alighting_lon',
  'ridership',
] as const;

export const MATCHING_ARC_PROPERTIES = [
  'boarding_stop_id', 'boarding_stop_name',
  'boarding_lat', 'boarding_lon',
  'alighting_stop_id', 'alighting_stop_name',
  'alighting_lat', 'alighting_lon',
  'passenger_count',
] as const;

export function getAvailableProperties(layer: LayerType): string[] {
  switch (layer) {
    case 'stops':
    case 'stops-buffer':
      return [...STOPS_DEFAULT_PROPERTIES, ...STOPS_JOIN_PROPERTIES];
    case 'lines':
    case 'lines-buffer':
      return [...LINES_DEFAULT_PROPERTIES, ...LINES_JOIN_PROPERTIES];
    case 'trips':
      return [...TRIPS_DEFAULT_PROPERTIES];
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
    case 'matching-arc':
      return [...MATCHING_ARC_PROPERTIES];
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
