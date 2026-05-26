import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';
import { tableExists, columnExists } from './loader';

function coerceBigInts<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'bigint') {
      (obj as Record<string, unknown>)[key] = Number(obj[key]);
    }
  }
  return obj;
}

interface StopRow {
  [key: string]: unknown;
}

interface ShapePoint {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

interface RouteWithShapes {
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_type: number;
  route_color: string | null;
  route_text_color: string | null;
  route_url: string | null;
  route_desc: string | null;
  agency_id: string | null;
  agency_name: string | null;
  trip_weekday: number;
  trip_holiday: number;
  trips_04: number; trips_05: number; trips_06: number; trips_07: number;
  trips_08: number; trips_09: number; trips_10: number; trips_11: number;
  trips_12: number; trips_13: number; trips_14: number; trips_15: number;
  trips_16: number; trips_17: number; trips_18: number; trips_19: number;
  trips_20: number; trips_21: number; trips_22: number; trips_23: number;
  trips_24: number; trips_25: number; trips_26: number; trips_27: number;
  trips_morning: number;
  trips_daytime: number;
  trips_evening: number;
  trips_latenight: number;
  shape_ids: string[];
}

interface TripStopTime {
  trip_id: string;
  route_id: string;
  service_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_type: number;
  route_color: string | null;
  direction_id: number | null;
  trip_headsign: string | null;
  shape_id: string | null;
  stop_lat: number;
  stop_lon: number;
  departure_time: string;
  stop_sequence: number;
}

interface SegmentRow {
  from_stop_id: string;
  from_stop_name: string;
  from_stop_lat: number;
  from_stop_lon: number;
  to_stop_id: string;
  to_stop_name: string;
  to_stop_lat: number;
  to_stop_lon: number;
  route_id: string;
  route_short_name: string | null;
  trip_weekday: number;
  trip_holiday: number;
  trips_04: number; trips_05: number; trips_06: number; trips_07: number;
  trips_08: number; trips_09: number; trips_10: number; trips_11: number;
  trips_12: number; trips_13: number; trips_14: number; trips_15: number;
  trips_16: number; trips_17: number; trips_18: number; trips_19: number;
  trips_20: number; trips_21: number; trips_22: number; trips_23: number;
  trips_24: number; trips_25: number; trips_26: number; trips_27: number;
  trips_morning: number;
  trips_daytime: number;
  trips_evening: number;
  trips_latenight: number;
}

export type { StopRow, ShapePoint, RouteWithShapes, TripStopTime, SegmentRow };

async function hasAgencyId(db: AsyncDuckDB): Promise<boolean> {
  const agencyExists = await tableExists(db, 'agency');
  if (!agencyExists) return false;
  return columnExists(db, 'agency', 'agency_id');
}

async function buildAgencyJoin(db: AsyncDuckDB): Promise<{ joinClause: string; nameExpr: string }> {
  const hasId = await hasAgencyId(db);
  const routeHasAgencyId = await columnExists(db, 'routes', 'agency_id');
  const agencyExists = await tableExists(db, 'agency');

  if (agencyExists && routeHasAgencyId && hasId) {
    return {
      joinClause: `LEFT JOIN agency a ON CAST(r.agency_id AS VARCHAR) = CAST(a.agency_id AS VARCHAR)`,
      nameExpr: `a.agency_name`,
    };
  }
  if (agencyExists) {
    return {
      joinClause: `LEFT JOIN agency a ON TRUE`,
      nameExpr: `(SELECT agency_name FROM agency LIMIT 1)`,
    };
  }
  return {
    joinClause: '',
    nameExpr: `NULL`,
  };
}

export async function queryStops(db: AsyncDuckDB): Promise<StopRow[]> {
  const hasCalendar = await tableExists(db, 'calendar');
  const hasDepartureTime = await columnExists(db, 'stop_times', 'departure_time');
  const { joinClause: agencyJoin, nameExpr: agencyNameExpr } = await buildAgencyJoin(db);
  const conn = await db.connect();
  try {
    const timeCol = hasDepartureTime ? 'st.departure_time' : 'st.arrival_time';
    const hourExpr = `CAST(SPLIT_PART(CAST(${timeCol} AS VARCHAR), ':', 1) AS INTEGER)`;

    const calendarJoin = hasCalendar
      ? `LEFT JOIN calendar c ON CAST(t.service_id AS VARCHAR) = CAST(c.service_id AS VARCHAR)`
      : '';
    const weekdayFilter = hasCalendar ? `c.monday = 1 AND ` : '';

    const weekdayCountExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN c.monday = 1 THEN t.trip_id END)`
      : `COUNT(DISTINCT t.trip_id)`;
    const holidayCountExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN c.sunday = 1 THEN t.trip_id END)`
      : `0`;

    const hourlyLines = [];
    for (let h = 4; h <= 27; h++) {
      const padded = String(h).padStart(2, '0');
      hourlyLines.push(
        `COUNT(DISTINCT CASE WHEN ${weekdayFilter}${hourExpr} = ${h} THEN t.trip_id END) AS trips_${padded}`
      );
    }

    const sql = `
      WITH stop_routes AS (
        SELECT
          st.stop_id,
          LIST(DISTINCT CAST(t.route_id AS VARCHAR) ORDER BY CAST(t.route_id AS VARCHAR)) AS routes,
          COUNT(DISTINCT t.route_id) AS route_count,
          MIN(${agencyNameExpr}) AS agency_name,
          ${weekdayCountExpr} AS trip_weekday,
          ${holidayCountExpr} AS trip_holiday,
          ${hourlyLines.join(',\n          ')},
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}${hourExpr} BETWEEN 4 AND 8 THEN t.trip_id END) AS trips_morning,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}${hourExpr} BETWEEN 9 AND 16 THEN t.trip_id END) AS trips_daytime,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}${hourExpr} BETWEEN 17 AND 20 THEN t.trip_id END) AS trips_evening,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}${hourExpr} BETWEEN 21 AND 27 THEN t.trip_id END) AS trips_latenight
        FROM stop_times st
        JOIN trips t ON CAST(st.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
        ${calendarJoin}
        LEFT JOIN routes r ON CAST(t.route_id AS VARCHAR) = CAST(r.route_id AS VARCHAR)
        ${agencyJoin}
        GROUP BY st.stop_id
      )
      SELECT s.*, sr.routes, sr.agency_name, sr.route_count,
             sr.trip_weekday, sr.trip_holiday,
             ${Array.from({ length: 24 }, (_, i) => `sr.trips_${String(i + 4).padStart(2, '0')}`).join(', ')},
             sr.trips_morning, sr.trips_daytime, sr.trips_evening, sr.trips_latenight
      FROM stops s
      LEFT JOIN stop_routes sr ON CAST(s.stop_id AS VARCHAR) = CAST(sr.stop_id AS VARCHAR)
    `;

    const result = await conn.query(sql);
    return result.toArray().map(row => {
      const obj = coerceBigInts(row.toJSON() as StopRow);
      if (obj.routes && typeof obj.routes === 'object' && Symbol.iterator in (obj.routes as object)) {
        obj.routes = Array.from(obj.routes as Iterable<unknown>);
      }
      return obj;
    });
  } finally {
    await conn.close();
  }
}

export async function queryShapePoints(db: AsyncDuckDB): Promise<ShapePoint[]> {
  const conn = await db.connect();
  try {
    const result = await conn.query(`
      SELECT
        CAST(shape_id AS VARCHAR) AS shape_id,
        CAST(shape_pt_lat AS DOUBLE) AS shape_pt_lat,
        CAST(shape_pt_lon AS DOUBLE) AS shape_pt_lon,
        CAST(shape_pt_sequence AS INTEGER) AS shape_pt_sequence
      FROM shapes
      ORDER BY shape_id, shape_pt_sequence
    `);
    return result.toArray().map(r => coerceBigInts(r.toJSON() as Record<string, unknown>) as unknown as ShapePoint);
  } finally {
    await conn.close();
  }
}

export async function queryRoutesWithShapes(db: AsyncDuckDB): Promise<RouteWithShapes[]> {
  const hasCalendar = await tableExists(db, 'calendar');
  const hasDepartureTime = await columnExists(db, 'stop_times', 'departure_time');
  const { joinClause: agencyJoin, nameExpr: agencyNameExpr } = await buildAgencyJoin(db);
  const routeHasAgencyId = await columnExists(db, 'routes', 'agency_id');
  const conn = await db.connect();
  try {
    const timeCol = hasDepartureTime ? 'st.departure_time' : 'st.arrival_time';
    const hourExpr = `CAST(SPLIT_PART(CAST(${timeCol} AS VARCHAR), ':', 1) AS INTEGER)`;

    const calendarJoin = hasCalendar
      ? `LEFT JOIN calendar c ON CAST(th.service_id AS VARCHAR) = CAST(c.service_id AS VARCHAR)`
      : '';
    const weekdayFilter = hasCalendar ? `c.monday = 1 AND ` : '';
    const weekdayExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN c.monday = 1 THEN th.trip_id END)`
      : `COUNT(DISTINCT th.trip_id)`;
    const holidayExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN c.sunday = 1 THEN th.trip_id END)`
      : `0`;

    const hourlyLines = [];
    for (let h = 4; h <= 27; h++) {
      const padded = String(h).padStart(2, '0');
      hourlyLines.push(
        `COUNT(DISTINCT CASE WHEN ${weekdayFilter}th.first_hour = ${h} THEN th.trip_id END) AS trips_${padded}`
      );
    }

    const agencyIdSelect = routeHasAgencyId ? `r.agency_id` : `NULL AS agency_id`;
    const agencyIdGroup = routeHasAgencyId ? `, r.agency_id` : '';

    const result = await conn.query(`
      WITH trip_hours AS (
        SELECT
          CAST(t.trip_id AS VARCHAR) AS trip_id,
          CAST(t.route_id AS VARCHAR) AS route_id,
          CAST(t.service_id AS VARCHAR) AS service_id,
          CAST(t.shape_id AS VARCHAR) AS shape_id,
          MIN(${hourExpr}) AS first_hour
        FROM trips t
        JOIN stop_times st ON CAST(t.trip_id AS VARCHAR) = CAST(st.trip_id AS VARCHAR)
        GROUP BY t.trip_id, t.route_id, t.service_id, t.shape_id
      )
      SELECT
        r.route_id,
        r.route_short_name,
        r.route_long_name,
        r.route_type,
        r.route_color,
        r.route_text_color,
        r.route_url,
        r.route_desc,
        ${agencyIdSelect},
        ${agencyNameExpr} AS agency_name,
        LIST(DISTINCT th.shape_id) FILTER (WHERE th.shape_id IS NOT NULL) AS shape_ids,
        ${weekdayExpr} AS trip_weekday,
        ${holidayExpr} AS trip_holiday,
        ${hourlyLines.join(',\n        ')},
        COUNT(DISTINCT CASE WHEN ${weekdayFilter}th.first_hour BETWEEN 4 AND 8 THEN th.trip_id END) AS trips_morning,
        COUNT(DISTINCT CASE WHEN ${weekdayFilter}th.first_hour BETWEEN 9 AND 16 THEN th.trip_id END) AS trips_daytime,
        COUNT(DISTINCT CASE WHEN ${weekdayFilter}th.first_hour BETWEEN 17 AND 20 THEN th.trip_id END) AS trips_evening,
        COUNT(DISTINCT CASE WHEN ${weekdayFilter}th.first_hour BETWEEN 21 AND 27 THEN th.trip_id END) AS trips_latenight
      FROM routes r
      ${agencyJoin}
      LEFT JOIN trip_hours th ON CAST(r.route_id AS VARCHAR) = CAST(th.route_id AS VARCHAR)
      ${calendarJoin}
      GROUP BY r.route_id, r.route_short_name, r.route_long_name,
               r.route_type, r.route_color, r.route_text_color,
               r.route_url, r.route_desc${agencyIdGroup}, ${agencyNameExpr === 'NULL' ? 'TRUE' : `${agencyNameExpr}`}
    `);
    return result.toArray().map(r => {
      const obj = coerceBigInts(r.toJSON() as Record<string, unknown>) as unknown as RouteWithShapes;
      if (obj.shape_ids && typeof obj.shape_ids === 'object' && Symbol.iterator in (obj.shape_ids as object)) {
        obj.shape_ids = Array.from(obj.shape_ids as Iterable<unknown>) as string[];
      }
      if (!obj.shape_ids) obj.shape_ids = [];
      return obj;
    });
  } finally {
    await conn.close();
  }
}

export async function queryTripsForDate(
  db: AsyncDuckDB,
  baseDateStr: string,
  routeFilter?: string,
): Promise<TripStopTime[]> {
  const hasCalendar = await tableExists(db, 'calendar');
  const hasCalendarDates = await tableExists(db, 'calendar_dates');
  const conn = await db.connect();
  try {
    const dateNum = baseDateStr.replace(/-/g, '');
    let serviceFilter = '';

    if (hasCalendar && hasCalendarDates) {
      const dow = new Date(baseDateStr).getDay();
      const dayCol = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dow]!;
      serviceFilter = `
        AND (
          (CAST(t.service_id AS VARCHAR) IN (
            SELECT CAST(service_id AS VARCHAR) FROM calendar
            WHERE ${dayCol} = 1
              AND CAST(start_date AS VARCHAR) <= '${dateNum}'
              AND CAST(end_date AS VARCHAR) >= '${dateNum}'
          )
          OR CAST(t.service_id AS VARCHAR) IN (
            SELECT CAST(service_id AS VARCHAR) FROM calendar_dates
            WHERE CAST(date AS VARCHAR) = '${dateNum}' AND CAST(exception_type AS INTEGER) = 1
          ))
          AND CAST(t.service_id AS VARCHAR) NOT IN (
            SELECT CAST(service_id AS VARCHAR) FROM calendar_dates
            WHERE CAST(date AS VARCHAR) = '${dateNum}' AND CAST(exception_type AS INTEGER) = 2
          )
        )
      `;
    } else if (hasCalendar) {
      const dow = new Date(baseDateStr).getDay();
      const dayCol = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dow]!;
      serviceFilter = `
        AND CAST(t.service_id AS VARCHAR) IN (
          SELECT CAST(service_id AS VARCHAR) FROM calendar
          WHERE ${dayCol} = 1
            AND CAST(start_date AS VARCHAR) <= '${dateNum}'
            AND CAST(end_date AS VARCHAR) >= '${dateNum}'
        )
      `;
    } else if (hasCalendarDates) {
      serviceFilter = `
        AND CAST(t.service_id AS VARCHAR) IN (
          SELECT CAST(service_id AS VARCHAR) FROM calendar_dates
          WHERE CAST(date AS VARCHAR) = '${dateNum}' AND CAST(exception_type AS INTEGER) = 1
        )
      `;
    }

    const routeCondition = routeFilter
      ? `AND CAST(t.route_id AS VARCHAR) = '${routeFilter}'`
      : '';

    const result = await conn.query(`
      SELECT
        CAST(t.trip_id AS VARCHAR) AS trip_id,
        CAST(t.route_id AS VARCHAR) AS route_id,
        CAST(t.service_id AS VARCHAR) AS service_id,
        r.route_short_name,
        r.route_long_name,
        r.route_type,
        r.route_color,
        t.direction_id,
        t.trip_headsign,
        CAST(t.shape_id AS VARCHAR) AS shape_id,
        CAST(s.stop_lat AS DOUBLE) AS stop_lat,
        CAST(s.stop_lon AS DOUBLE) AS stop_lon,
        CAST(COALESCE(st.departure_time, st.arrival_time) AS VARCHAR) AS departure_time,
        CAST(st.stop_sequence AS INTEGER) AS stop_sequence
      FROM stop_times st
      JOIN trips t ON CAST(st.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
      JOIN stops s ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
      LEFT JOIN routes r ON CAST(t.route_id AS VARCHAR) = CAST(r.route_id AS VARCHAR)
      WHERE 1=1 ${serviceFilter} ${routeCondition}
      ORDER BY t.trip_id, st.stop_sequence
    `);
    return result.toArray().map(r => coerceBigInts(r.toJSON() as Record<string, unknown>) as unknown as TripStopTime);
  } finally {
    await conn.close();
  }
}

export async function queryStopSequenceForRoute(db: AsyncDuckDB, routeId: string): Promise<Array<{ stop_lat: number; stop_lon: number }>> {
  const hasDirectionId = await columnExists(db, 'trips', 'direction_id');
  const conn = await db.connect();
  try {
    const dirFilter = hasDirectionId ? `AND t.direction_id = 0` : '';
    const result = await conn.query(`
      WITH ranked AS (
        SELECT
          CAST(s.stop_lat AS DOUBLE) AS stop_lat,
          CAST(s.stop_lon AS DOUBLE) AS stop_lon,
          st.stop_sequence,
          ROW_NUMBER() OVER (PARTITION BY st.stop_sequence ORDER BY t.trip_id) AS rn
        FROM stop_times st
        JOIN trips t ON CAST(st.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
        JOIN stops s ON CAST(st.stop_id AS VARCHAR) = CAST(s.stop_id AS VARCHAR)
        WHERE CAST(t.route_id AS VARCHAR) = '${routeId}'
          ${dirFilter}
      )
      SELECT stop_lat, stop_lon FROM ranked WHERE rn = 1 ORDER BY stop_sequence
    `);
    return result.toArray().map(r => coerceBigInts(r.toJSON() as Record<string, unknown>) as unknown as { stop_lat: number; stop_lon: number });
  } finally {
    await conn.close();
  }
}

export async function querySegments(db: AsyncDuckDB): Promise<SegmentRow[]> {
  const hasCalendar = await tableExists(db, 'calendar');
  const hasDepartureTime = await columnExists(db, 'stop_times', 'departure_time');
  const conn = await db.connect();
  try {
    const calendarJoin = hasCalendar
      ? `LEFT JOIN calendar c ON CAST(t.service_id AS VARCHAR) = CAST(c.service_id AS VARCHAR)`
      : '';
    const weekdayFilter = hasCalendar ? `monday = 1 AND ` : '';

    const timeCol = hasDepartureTime ? 'st.departure_time' : 'st.arrival_time';
    const hourExpr = `CAST(SPLIT_PART(CAST(${timeCol} AS VARCHAR), ':', 1) AS INTEGER)`;

    const weekdayExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN monday = 1 THEN trip_id END)`
      : `COUNT(DISTINCT trip_id)`;
    const holidayExpr = hasCalendar
      ? `COUNT(DISTINCT CASE WHEN sunday = 1 THEN trip_id END)`
      : `0`;

    const hourlyLines = [];
    for (let h = 4; h <= 27; h++) {
      const padded = String(h).padStart(2, '0');
      hourlyLines.push(
        `COUNT(DISTINCT CASE WHEN ${weekdayFilter}hour = ${h} THEN trip_id END) AS trips_${padded}`
      );
    }

    const result = await conn.query(`
      WITH ordered AS (
        SELECT
          CAST(t.route_id AS VARCHAR) AS route_id,
          r.route_short_name,
          CAST(st.stop_id AS VARCHAR) AS stop_id,
          CAST(st.stop_sequence AS INTEGER) AS stop_sequence,
          CAST(t.trip_id AS VARCHAR) AS trip_id,
          ${hourExpr} AS hour,
          ${hasCalendar ? 'c.monday, c.sunday,' : ''}
          LEAD(CAST(st.stop_id AS VARCHAR)) OVER (
            PARTITION BY st.trip_id ORDER BY CAST(st.stop_sequence AS INTEGER)
          ) AS next_stop_id
        FROM stop_times st
        JOIN trips t ON CAST(st.trip_id AS VARCHAR) = CAST(t.trip_id AS VARCHAR)
        LEFT JOIN routes r ON CAST(t.route_id AS VARCHAR) = CAST(r.route_id AS VARCHAR)
        ${calendarJoin}
      ),
      seg AS (
        SELECT
          route_id,
          route_short_name,
          stop_id AS from_stop_id,
          next_stop_id AS to_stop_id,
          ${weekdayExpr} AS trip_weekday,
          ${holidayExpr} AS trip_holiday,
          ${hourlyLines.join(',\n          ')},
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}hour BETWEEN 4 AND 8 THEN trip_id END) AS trips_morning,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}hour BETWEEN 9 AND 16 THEN trip_id END) AS trips_daytime,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}hour BETWEEN 17 AND 20 THEN trip_id END) AS trips_evening,
          COUNT(DISTINCT CASE WHEN ${weekdayFilter}hour BETWEEN 21 AND 27 THEN trip_id END) AS trips_latenight
        FROM ordered
        WHERE next_stop_id IS NOT NULL
        GROUP BY route_id, route_short_name, stop_id, next_stop_id
      )
      SELECT
        seg.from_stop_id,
        s1.stop_name AS from_stop_name,
        CAST(s1.stop_lat AS DOUBLE) AS from_stop_lat,
        CAST(s1.stop_lon AS DOUBLE) AS from_stop_lon,
        seg.to_stop_id,
        s2.stop_name AS to_stop_name,
        CAST(s2.stop_lat AS DOUBLE) AS to_stop_lat,
        CAST(s2.stop_lon AS DOUBLE) AS to_stop_lon,
        seg.route_id,
        seg.route_short_name,
        seg.trip_weekday,
        seg.trip_holiday,
        ${Array.from({ length: 24 }, (_, i) => `seg.trips_${String(i + 4).padStart(2, '0')}`).join(', ')},
        seg.trips_morning,
        seg.trips_daytime,
        seg.trips_evening,
        seg.trips_latenight
      FROM seg
      JOIN stops s1 ON CAST(s1.stop_id AS VARCHAR) = seg.from_stop_id
      JOIN stops s2 ON CAST(s2.stop_id AS VARCHAR) = seg.to_stop_id
    `);
    return result.toArray().map(r => coerceBigInts(r.toJSON() as Record<string, unknown>) as unknown as SegmentRow);
  } finally {
    await conn.close();
  }
}
