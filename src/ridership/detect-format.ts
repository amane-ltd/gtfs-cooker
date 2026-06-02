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

// 時刻 / 日時を表す列名の候補。優先度順（datetime > time > hour）。
const TIME_COL_CANDIDATES = [
  // 日時 / タイムスタンプ
  'payment_at', 'boarding_at', 'boarding_time', 'alighting_at', 'alighting_time',
  'record_at', 'recorded_at', 'operated_at', 'datetime', 'timestamp',
  'taken_at', 'used_at',
  // JP
  '日時', 'タイムスタンプ', '乗車日時', '降車日時',
  '発車時刻', '到着時刻', '出発時刻',
  '発車時間', '到着時間', '出発時間',
  '時刻', '時間',
  // 時刻のみ
  'time', 'hour', 'time_band',
];

function detectTimeCol(headers: string[]): string | null {
  const lcHeaders = headers.map(h => ({ raw: h, lc: h.trim().toLowerCase() }));
  for (const name of TIME_COL_CANDIDATES) {
    const target = name.toLowerCase();
    const exact = lcHeaders.find(h => h.lc === target);
    if (exact) return exact.raw;
  }
  // 部分一致フォールバック（より緩い）
  const partials = ['datetime', 'timestamp', 'payment_at', '_time', '日時', '時刻', '時間'];
  for (const pat of partials) {
    const target = pat.toLowerCase();
    const partial = lcHeaders.find(h => h.lc.includes(target));
    if (partial) return partial.raw;
  }
  return null;
}

export function defaultFieldConfig(format: RidershipFormat, headers: string[]): RidershipFieldConfig {
  const lc = new Set(headers.map(h => h.trim().toLowerCase()));
  const find = (name: string) => headers.find(h => h.trim().toLowerCase() === name) ?? null;
  const timeColAuto = detectTimeCol(headers);

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
        passThroughCol: null,
        timeCol: timeColAuto,
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
        passThroughCol: null,
        timeCol: timeColAuto,
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
        passThroughCol: null,
        timeCol: timeColAuto,
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
        passThroughCol: null,
        timeCol: timeColAuto,
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
        passThroughCol: null,
        timeCol: timeColAuto,
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
        passThroughCol: find('通過人数'),
        timeCol: timeColAuto,
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
        passThroughCol: null,
        timeCol: timeColAuto,
      };
  }
}
