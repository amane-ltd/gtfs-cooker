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

  // 英語ヘッダ版（stop-trip-detail）。`count` を持たないため route-aggregate 等とは競合しない。
  if (set.has('boarding_count') && set.has('alighting_count') && (set.has('stop_name') || set.has('stop') || set.has('stop_id')) && set.has('trip_id')) {
    return 'stop-trip-detail';
  }

  return 'unknown';
}

// 時刻 / 日時を表す列名の候補。優先度順（boarding > payment > datetime > time > hour）。
// matching-trips の便割り当ては「乗車時刻」が必要なので boarding_at を優先する。
const TIME_COL_CANDIDATES = [
  // 乗車時刻系（最優先）
  'boarding_at', 'boarding_time',
  // 日時 / タイムスタンプ
  'payment_at', 'alighting_at', 'alighting_time',
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

// 日付列の候補。優先度順。
const DATE_COL_CANDIDATES = [
  // 日付＋専用接尾辞
  'boarding_date', 'service_date', 'operation_date', 'record_date', 'recorded_date',
  'travel_date', 'trip_date',
  // JP
  '乗車日', '運行日', '運転日', '日付', '年月日', '日次',
  // 単独
  'date',
];

function detectDateCol(headers: string[]): string | null {
  const lcHeaders = headers.map(h => ({ raw: h, lc: h.trim().toLowerCase() }));
  for (const name of DATE_COL_CANDIDATES) {
    const target = name.toLowerCase();
    const exact = lcHeaders.find(h => h.lc === target);
    if (exact) return exact.raw;
  }
  // 部分一致フォールバック（曖昧なので限定的に）
  const partials = ['_date', '運行日', '日付'];
  for (const pat of partials) {
    const target = pat.toLowerCase();
    const partial = lcHeaders.find(h => h.lc.includes(target));
    if (partial) return partial.raw;
  }
  return null;
}

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
  const dateColAuto = detectDateCol(headers);

  switch (format) {
    case 'commons-detail':
      return {
        boardingStopCol: find('boarding_station_name') ?? find('boarding_station_code'),
        alightingStopCol: find('alighting_station_name') ?? find('alighting_station_code'),
        stopGtfsField: 'stop_name',
        // COMmmmONS は boarding_route_id を GTFS route_id と直接対応させる仕様。
        routeCol: find('boarding_route_id') ?? find('boarding_route_name'),
        routeGtfsField: 'route_id',
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
        dateCol: dateColAuto,
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
        dateCol: dateColAuto,
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
        dateCol: dateColAuto,
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
        dateCol: dateColAuto,
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
        dateCol: dateColAuto,
      };
    case 'stop-trip-detail':
      return {
        boardingStopCol: find('停留所名') ?? find('停留所') ?? find('停留所id')
          ?? find('stop_name') ?? find('stop') ?? find('stop_id'),
        alightingStopCol: null,
        stopGtfsField: 'stop_name',
        routeCol: find('路線名') ?? find('路線id')
          ?? find('route_name') ?? find('route_long_name') ?? find('route_id'),
        routeGtfsField: 'route_long_name',
        agencyCol: null,
        agencyGtfsField: 'agency_name',
        countCols: [],
        countOnCol: find('乗車人数') ?? find('boarding_count'),
        countOffCol: find('降車人数') ?? find('alighting_count'),
        tripIdCol: find('便id') ?? find('trip_id'),
        passThroughCol: find('通過人数') ?? find('pass_through_count') ?? find('onboard_count'),
        timeCol: timeColAuto,
        dateCol: dateColAuto,
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
        dateCol: dateColAuto,
      };
  }
}
