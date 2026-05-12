/**
 * db.svelte.ts — DuckDB-WASM singleton
 *
 * Two separate concerns:
 *
 *   1. OVERVIEW  — reads local static/overview_h3_4.parquet (tiny, instant)
 *                  loaded on boot, no S3 required
 *
 *   2. S3 QUERIES — species tab and area tab hit S3 on demand
 *                   httpfs + spatial extensions loaded once
 *
 * Species list is pre-fetched from S3 in background after boot.
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

// Keep a direct reference to the AsyncDuckDB instance so we can call
// registerFileBuffer() on it later — we can't reach it via the connection.
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
    dbInstance = instance;                        // ← keep the reference
    connection = await instance.connect();

    // Each extension on its own query() call — a multi-statement string
    // silently swallows errors in DuckDB-WASM, making failures invisible.
    await connection.query(`INSTALL httpfs;`);
    await connection.query(`LOAD httpfs;`);
    await connection.query(`SET s3_region = 'us-east-1';`);

    // spatial extension enables ST_Intersects / ST_GeomFromText for the area query.
    // It IS bundled with DuckDB-WASM (unlike the community H3 extension).
    await connection.query(`INSTALL spatial;`);
    await connection.query(`LOAD spatial;`);

    // h3 extension
    await connection.query(`INSTALL h3 FROM community;`);
    await connection.query(`LOAD h3;`);

    // Register S3 view (no data fetched yet — lazy on first query)
    await connection.query(`
      CREATE OR REPLACE VIEW speciesgrids AS
      SELECT cell, species, genus, family, "class", phylum, kingdom,
             records, AphiaID, min_year, max_year, geometry
      FROM read_parquet('s3://obis-products/speciesgrids/h3_7/*');
    `);

    db.status = 'ready';

    // Pre-fetch species list in background
    _prefetchSpecies();
  } catch (err) {
    db.error  = String(err);
    db.status = 'error';
    throw err;
  }
}

// async function _prefetchSpecies() {
//   if (!connection) return;
//   try {
//     const r = await connection.query(
//       `SELECT DISTINCT species
//        FROM speciesgrids 
//        --WHERE species IS NOT NULL 
//        --ORDER BY species`
//     );
//     db.speciesList   = r.toArray().map((row: any) => String(row.species));
//     db.speciesLoaded = true;
//   } catch (e) {
//     console.warn('Species prefetch failed:', e);
//   }
// }
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
      const list: string[] = Array.isArray(json) ? json : json.species;
 
      // Use splice to mutate in place rather than replacing the array reference.
      // Svelte 5's $state proxy tracks mutations on the existing array reliably
      // across async boundaries in production builds; replacing the reference
      // (db.speciesList = newArray) can silently lose reactivity after an await.
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
      `SELECT DISTINCT species
       FROM speciesgrids 
       -- WHERE species IS NOT NULL 
       -- ORDER BY species`
    );
    db.speciesList   = r.toArray().map((row: any) => String(row.species));
    db.speciesLoaded = true;
  } catch (e) {
    console.warn('Species prefetch failed:', e);
  }
}

// ── Load the local overview parquet (served from /static) ────────────────
// Flow:
//   1. fetch('/overview_h3_4.parquet')  → ArrayBuffer  (normal HTTP from Svelte static/)
//   2. dbInstance.registerFileBuffer()  → puts bytes into DuckDB's in-memory VFS
//   3. read_parquet('overview_h3_4.parquet') → DuckDB reads from its own VFS
//
// The key: registerFileBuffer must be called on the AsyncDuckDB instance,
// not the connection. We keep dbInstance for exactly this purpose.
export async function loadOverview(): Promise<{ cell: string; total_species: number }[]> {
  if (!connection || !dbInstance) throw new Error('DuckDB not ready');

  const resp = await fetch(asset('/overview_h3_4.parquet'));
  if (!resp.ok) throw new Error(`Could not load overview parquet (HTTP ${resp.status}). Have you run generate_overview.py?`);
  const buf = await resp.arrayBuffer();

  // Register under a simple name — this becomes the virtual path DuckDB uses
  await dbInstance.registerFileBuffer('overview_h3_4.parquet', new Uint8Array(buf));

  const result = await connection.query(`
    SELECT cell, total_species
    FROM read_parquet('overview_h3_4.parquet')
  `);

  return result.toArray().map((r: any) => ({
    cell:          String(r.cell),
    total_species: Number(r.total_species),
  }));
}

// ── Generic query runner ──────────────────────────────────────────────────
export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  if (!connection) throw new Error('DuckDB not ready');
  const result = await connection.query(sql);
  const cols   = result.schema.fields.map((f: any) => f.name);
  return result.toArray().map((row: any) =>
    Object.fromEntries(cols.map(c => [c, row[c]]))
  );
}
