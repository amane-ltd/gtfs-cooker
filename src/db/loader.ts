import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';

const GTFS_TABLE_NAMES = [
  'agency', 'stops', 'routes', 'trips', 'stop_times',
  'calendar', 'calendar_dates', 'shapes',
  'fare_attributes', 'fare_rules', 'frequencies',
  'transfers', 'feed_info',
  'translations', 'attributions', 'levels', 'pathways',
  'agency_jp', 'routes_jp', 'office_jp',
] as const;

function fileNameToTable(fileName: string): string | null {
  const base = fileName.replace(/\.txt$/, '').toLowerCase();
  if ((GTFS_TABLE_NAMES as readonly string[]).includes(base)) return base;
  return null;
}

export async function dropAllTables(db: AsyncDuckDB): Promise<void> {
  const conn = await db.connect();
  try {
    for (const table of GTFS_TABLE_NAMES) {
      await conn.query(`DROP TABLE IF EXISTS ${table}`);
    }
  } finally {
    await conn.close();
  }
}

export async function loadCsvIntoTable(
  db: AsyncDuckDB,
  fileName: string,
  csvText: string,
): Promise<string | null> {
  const tableName = fileNameToTable(fileName);
  if (!tableName) return null;

  if (!csvText.trim()) return null;

  const tempFile = `${tableName}_${Date.now()}.csv`;
  await db.registerFileText(tempFile, csvText);

  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
    await conn.query(
      `CREATE TABLE ${tableName} AS SELECT * FROM read_csv_auto('${tempFile}', header=true, all_varchar=false, ignore_errors=true, null_padding=true)`,
    );

    await ensureKeyColumns(conn, tableName);
  } finally {
    await conn.close();
    await db.dropFile(tempFile);
  }

  return tableName;
}

async function ensureKeyColumns(conn: { query: (sql: string) => Promise<unknown> }, tableName: string): Promise<void> {
  const columnsNeeded: Record<string, string[]> = {
    agency: ['agency_id', 'agency_name'],
    routes: ['agency_id', 'route_color', 'route_text_color', 'route_url', 'route_desc', 'route_short_name', 'route_long_name'],
    trips: ['shape_id', 'direction_id', 'trip_headsign'],
    stops: ['stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station', 'stop_code', 'platform_code', 'zone_id', 'wheelchair_boarding', 'stop_url', 'stop_desc'],
    stop_times: ['departure_time', 'arrival_time'],
  };

  const needed = columnsNeeded[tableName];
  if (!needed) return;

  for (const col of needed) {
    try {
      await conn.query(`SELECT "${col}" FROM ${tableName} LIMIT 0`);
    } catch {
      await conn.query(`ALTER TABLE ${tableName} ADD COLUMN "${col}" VARCHAR DEFAULT NULL`);
    }
  }
}

export async function getTableRowCount(db: AsyncDuckDB, tableName: string): Promise<number> {
  const conn = await db.connect();
  try {
    const result = await conn.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    const rows = result.toArray();
    return Number(rows[0]?.cnt ?? 0);
  } finally {
    await conn.close();
  }
}

export async function tableExists(db: AsyncDuckDB, tableName: string): Promise<boolean> {
  const conn = await db.connect();
  try {
    const result = await conn.query(
      `SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = '${tableName}'`,
    );
    const rows = result.toArray();
    return Number(rows[0]?.cnt ?? 0) > 0;
  } finally {
    await conn.close();
  }
}

export async function columnExists(db: AsyncDuckDB, tableName: string, columnName: string): Promise<boolean> {
  const conn = await db.connect();
  try {
    const result = await conn.query(
      `SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = '${columnName}'`,
    );
    const rows = result.toArray();
    return Number(rows[0]?.cnt ?? 0) > 0;
  } finally {
    await conn.close();
  }
}
