export type RidershipFormat =
  | 'commons-detail'
  | 'detail'
  | 'od-aggregate'
  | 'station-aggregate'
  | 'route-aggregate'
  | 'stop-trip-detail'
  | 'unknown';

export type ReconciliationMode = 'direct' | 'upload-mapping' | 'auto-match';

export type MatchStatus =
  | 'exact-id'
  | 'exact-name'
  | 'normalized'
  | 'partial'
  | 'unmatched'
  | 'manual'
  | 'skipped';

export interface MappingRow {
  odCode: string;
  odName: string;
  gtfsIds: { id: string; name: string }[];
  status: MatchStatus;
}

export interface CandidateGroup {
  groupId: string;
  groupName: string;
  entries: { id: string; name: string }[];
}

export type MappingType = 'stop' | 'route' | 'agency';

export interface RidershipSummary {
  format: RidershipFormat;
  rowCount: number;
}

export interface JoinStats {
  matched: number;
  unmatched: number;
  coverageStops: number;
  coverageRoutes: number;
}

export type StopGtfsField = 'stop_id' | 'stop_name';
export type RouteGtfsField = 'route_id' | 'route_short_name' | 'route_long_name';
export type AgencyGtfsField = 'agency_id' | 'agency_name';

export interface RidershipFieldConfig {
  boardingStopCol: string | null;
  alightingStopCol: string | null;
  stopGtfsField: StopGtfsField;

  routeCol: string | null;
  routeGtfsField: RouteGtfsField;

  agencyCol: string | null;
  agencyGtfsField: AgencyGtfsField;

  countCols: string[];
  countOnCol: string | null;
  countOffCol: string | null;

  tripIdCol: string | null;
  passThroughCol: string | null;

  /** 日付列（任意）。設定された場合は dateCol を日付ソースとして使い、
   *  timeCol は時刻 (HH:MM[:SS]) のみとして扱う。
   *  未設定の場合は timeCol から日付プレフィックスを抽出する。 */
  dateCol: string | null;
  /** 時刻 / 日時列。dateCol が未設定なら datetime（YYYY-MM-DD HH:MM:SS など）が前提。
   *  dateCol が設定済みなら時刻部分のみ（HH:MM:SS）。 */
  timeCol: string | null;
}
