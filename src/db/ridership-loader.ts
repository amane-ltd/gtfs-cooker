import type { AsyncDuckDB } from '@duckdb/duckdb-wasm';

const RIDERSHIP_TABLES = [
  'ridership', 'stop_mapping', 'route_mapping', 'agency_mapping',
  'ridership_by_stop', 'ridership_by_route', 'ridership_by_segment',
  'ridership_by_flow', 'ridership_arc',
] as const;

export async function dropRidershipTables(db: AsyncDuckDB): Promise<void> {
  const conn = await db.connect();
  try {
    for (const table of RIDERSHIP_TABLES) {
      await conn.query(`DROP TABLE IF EXISTS ${table}`);
    }
  } finally {
    await conn.close();
  }
}

export async function loadRidershipCsv(
  db: AsyncDuckDB,
  csvText: string,
): Promise<number> {
  const tempFile = `ridership_${Date.now()}.csv`;
  await db.registerFileText(tempFile, csvText);

  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ridership`);
    await conn.query(
      `CREATE TABLE ridership AS SELECT * FROM read_csv_auto('${tempFile}', header=true, all_varchar=true, ignore_errors=true, null_padding=true)`,
    );
    const result = await conn.query(`SELECT COUNT(*) as cnt FROM ridership`);
    return Number(result.toArray()[0]?.cnt ?? 0);
  } finally {
    await conn.close();
    await db.dropFile(tempFile);
  }
}

export async function loadMappingCsv(
  db: AsyncDuckDB,
  type: 'stop' | 'route' | 'agency',
  csvText: string,
): Promise<{ count: number; rows: { odValue: string; gtfsValue: string }[] }> {
  const tableName = `${type}_mapping`;
  const tempName = `_tmp_${tableName}_${Date.now()}`;
  const tempFile = `${tempName}.csv`;
  await db.registerFileText(tempFile, csvText);

  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ${tempName}`);
    await conn.query(
      `CREATE TABLE ${tempName} AS SELECT * FROM read_csv_auto('${tempFile}', header=true, all_varchar=true)`,
    );

    const colsRes = await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${tempName}' ORDER BY ordinal_position`);
    const cols = colsRes.toArray().map(r => String((r as { toJSON: () => Record<string, unknown> }).toJSON().column_name));

    const odCol = cols[0];
    const gtfsCol = cols[1];
    if (!odCol || !gtfsCol) throw new Error('Mapping CSV must have at least 2 columns');

    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
    await conn.query(
      `CREATE TABLE ${tableName} AS SELECT CAST("${odCol}" AS VARCHAR) AS od_value, CAST("${gtfsCol}" AS VARCHAR) AS gtfs_value FROM ${tempName}`,
    );
    await conn.query(`DROP TABLE ${tempName}`);

    const result = await conn.query(`SELECT od_value, gtfs_value FROM ${tableName}`);
    const rows = result.toArray().map(r => {
      const o = (r as { toJSON: () => Record<string, unknown> }).toJSON();
      return { odValue: String(o.od_value ?? ''), gtfsValue: String(o.gtfs_value ?? '') };
    });

    return { count: rows.length, rows };
  } finally {
    await conn.close();
    await db.dropFile(tempFile);
  }
}

export async function loadMappingRows(
  db: AsyncDuckDB,
  type: 'stop' | 'route' | 'agency',
  rows: { odCode: string; gtfsIds: { id: string; name: string }[] }[],
): Promise<void> {
  const tableName = `${type}_mapping`;
  const conn = await db.connect();
  try {
    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
    await conn.query(`CREATE TABLE ${tableName} (od_value VARCHAR, gtfs_value VARCHAR)`);

    const pairs: [string, string][] = [];
    for (const r of rows) {
      for (const g of r.gtfsIds) {
        pairs.push([r.odCode, g.id]);
      }
    }
    if (pairs.length === 0) return;

    const escape = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const batchSize = 500;

    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const values = batch.map(([od, gtfs]) => `(${escape(od)}, ${escape(gtfs)})`).join(', ');
      await conn.query(`INSERT INTO ${tableName} VALUES ${values}`);
    }
  } finally {
    await conn.close();
  }
}
