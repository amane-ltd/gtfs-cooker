import type { RidershipFormat, RidershipFieldConfig } from './types';

export function detectRidershipFormat(headers: string[]): RidershipFormat {
  const set = new Set(headers.map(h => h.trim().toLowerCase()));

  if (set.has('ridership_record_id') && set.has('payment_at')) {
    return 'commons-detail';
  }

  if (set.has('count_on') && set.has('count_off')) {
    return 'station-aggregate';
  }

  if (set.has('boarding_station_code') && set.has('alighting_station_code') && set.has('count')) {
    return 'od-aggregate';
  }

  if ((set.has('boarding_route_id') || set.has('route_id')) && set.has('count')) {
    return 'route-aggregate';
  }

  if (set.has('乗車人数') && set.has('降車人数') && (set.has('停留所名') || set.has('停留所') || set.has('停留所id')) && set.has('便id')) {
    return 'stop-trip-detail';
  }

  return 'unknown';
}

export function defaultFieldConfig(format: RidershipFormat, headers: string[]): RidershipFieldConfig {
  const lc = new Set(headers.map(h => h.trim().toLowerCase()));
  const find = (name: string) => headers.find(h => h.trim().toLowerCase() === name) ?? null;

  switch (format) {
    case 'commons-detail':
      return {
        boardingStopCol: find('boarding_station_name') ?? find('boarding_station_code'),
        alightingStopCol: find('alighting_station_name') ?? find('alighting_station_code'),
        stopGtfsField: 'stop_name',
        routeCol: find('boarding_route_name') ?? find('boarding_route_id'),
        routeGtfsField: 'route_long_name',
        agencyCol: find('operating_agency_name') ?? find('operating_agency_code'),
        agencyGtfsField: 'agency_name',
        countCols: [
          'adult_passenger_count',
          'adult_challenged_passenger_count',
          'child_passenger_count',
          'child_challenged_passenger_count',
        ].filter(c => lc.has(c)),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
    case 'station-aggregate':
      return {
        boardingStopCol: find('station_name') ?? find('station_code'),
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: find('count_on'),
        countOffCol: find('count_off'),
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
    case 'od-aggregate':
      return {
        boardingStopCol: find('boarding_station_name') ?? find('boarding_station_code'),
        alightingStopCol: find('alighting_station_name') ?? find('alighting_station_code'),
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: ['count'].filter(c => lc.has(c)),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
    case 'route-aggregate':
      return {
        boardingStopCol: null,
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: find('boarding_route_name') ?? find('route_name') ?? find('boarding_route_id') ?? find('route_id'),
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: ['count'].filter(c => lc.has(c)),
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
    case 'detail':
      return {
        boardingStopCol: null,
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
    case 'stop-trip-detail':
      return {
        boardingStopCol: find('停留所名') ?? find('停留所') ?? find('停留所id'),
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: find('路線名') ?? find('路線id'),
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: find('乗車人数'),
        countOffCol: find('降車人数'),
        tripIdCol: find('便id'),
        stopSequenceCol: find('停留所順'),
        passThroughCol: find('通過人数'),
      };
    default:
      return {
        boardingStopCol: null,
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: null,
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: null,
        countOffCol: null,
        tripIdCol: null,
        stopSequenceCol: null,
        passThroughCol: null,
      };
  }
}
