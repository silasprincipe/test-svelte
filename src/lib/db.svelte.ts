/**
 * db.svelte.ts — DuckDB-WASM singleton
 */

import * as duckdb from '@duckdb/duckdb-wasm';
import { asset } from '$app/paths';

export const db = $state({
  status:        'idle' as 'idle' | 'booting' | 'ready' | 'error',
  error:         null as string | null,
  speciesList:   [] as string[],
  speciesLoaded: false,
});

export let connection: duckdb.AsyncDuckDBConnection | null = null;
let dbInstance: duckdb.AsyncDuckDB | null = null;
let bootPromise: Promise<void> | null = null;

export async function boot(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = _boot();
  return bootPromise;
}

async function _boot() {
  db.status = 'booting';
  try {
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);

    const instance = new duckdb.AsyncDuckDB(
      new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker
    );
    await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);
    dbInstance = instance;
    connection = await instance.connect();

    await connection.query(`INSTALL httpfs;`);
    await connection.query(`LOAD httpfs;`);
    await connection.query(`SET s3_region = 'us-east-1';`);
    await connection.query(`INSTALL spatial;`);
    await connection.query(`LOAD spatial;`);
    await connection.query(`INSTALL h3 FROM community;`);
    await connection.query(`LOAD h3;`);

    await connection.query(`
      CREATE OR REPLACE VIEW speciesgrids AS
      SELECT cell, species, genus, family, "class", phylum, kingdom,
             records, AphiaID, min_year, max_year, geometry
      FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*');
    `);

    db.status = 'ready';
    _prefetchSpecies();
    _warmCache();   // start warming S3 parquet metadata in background
  } catch (err) {
    db.error  = String(err);
    db.status = 'error';
    throw err;
  }
}

async function _prefetchSpecies() {
  if (!connection) return;

  try {
    const resp = await fetch(asset('/species_list.json'));
    if (resp.ok) {
      const contentType = resp.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        throw new Error(`Expected JSON, got ${contentType}`);
      }
      const json = await resp.json();
      const list: string[] = (Array.isArray(json) ? json : json.species)
        .filter((s: unknown) => s != null);
      db.speciesList = list;
      db.speciesLoaded = true;
      return;
    }
  } catch (e) {
    console.warn('species_list.json not available, falling back to S3:', e);
  }

  // Fall back to querying S3 directly
  try {
    const r = await connection.query(
      `SELECT DISTINCT species FROM speciesgrids WHERE species IS NOT NULL ORDER BY species`
    );
    const list = r.toArray().map((row: any) => String(row.species));
    db.speciesList = list;
    db.speciesLoaded = true;
  } catch (e) {
    console.warn('Species prefetch failed:', e);
  }
}

// ── S3 parquet cache warming ───────────────────────────────────────────────
// The first real query against S3 is slow because DuckDB has to fetch the
// footer metadata from every parquet file in the glob to build the row-group
// index (hundreds of HTTP requests). Subsequent queries are fast because
// the metadata is cached in the WASM heap.
//
// We warm the cache by running a cheap COUNT(*) in the background after boot.
// It touches all file footers without transferring actual row data, so by the
// time the user runs their first real query the metadata is already cached.
let cacheWarmed = false;

async function _warmCache() {
  if (!connection || cacheWarmed) return;
  cacheWarmed = true;
  try {
    await connection.query(
      `SELECT COUNT(*) FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*')`
    );
  } catch { }
}

export async function loadOverview(): Promise<{ cell: string; total_species: number }[]> {
  if (!connection || !dbInstance) throw new Error('DuckDB not ready');

  const resp = await fetch(asset('/overview_h3_4.parquet'));
  if (!resp.ok) throw new Error(`Could not load overview parquet (HTTP ${resp.status}). Have you run generate_overview.py?`);
  const buf = await resp.arrayBuffer();

  await dbInstance.registerFileBuffer('overview_h3_4.parquet', new Uint8Array(buf));

  const result = await connection.query(`
    SELECT cell, total_species
    FROM read_parquet('overview_h3_4.parquet')
  `);

  const rows = result.toArray().map((r: any) => ({
    cell:          String(r.cell),
    total_species: Number(r.total_species),
  }));

  // Local parquet is loaded and map is about to render — good moment to warm
  // the S3 parquet metadata cache in the background so the first real query is fast.
  _warmCache();

  return rows;
}

export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  if (!connection) throw new Error('DuckDB not ready');
  const result = await connection.query(sql);
  const cols   = result.schema.fields.map((f: any) => f.name);
  return result.toArray().map((row: any) =>
    Object.fromEntries(cols.map(c => [c, row[c]]))
  );
}