<script lang="ts">
  export const prerender = true;
  // No logic needed — pure content page
</script>

<svelte:head>
  <title>OBIS speciesgrids — Documentation</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet" />
</svelte:head>

<div class="page">

  <!-- Nav -->
  <nav>
    <a href="/" class="back">← Back to Explorer</a>
    <a href="https://github.com/iobis/speciesgrids" target="_blank" rel="noopener" class="gh">
      GitHub ↗
    </a>
  </nav>

  <main>

    <!-- Hero -->
    <header class="hero">
      <div class="hero-eyebrow">Ocean Biodiversity Information System</div>
      <h1>speciesgrids</h1>
      <p class="hero-sub">
        Gridded marine species distributions at global scale —
        serverless, cloud-native, and open.
      </p>
      <div class="hero-badges">
        <span class="badge blue">H3 Resolution 7</span>
        <span class="badge green">GeoParquet on S3</span>
        <span class="badge purple">WoRMS aligned</span>
        <span class="badge orange">OBIS + GBIF</span>
      </div>
    </header>

    <!-- What is it -->
    <section>
      <h2>What is speciesgrids?</h2>
      <p>
        <strong>speciesgrids</strong> is a Python package that builds gridded datasets of
        WoRMS-aligned marine species distributions as <strong>GeoParquet</strong>, combining
        occurrence snapshots from both <a href="https://obis.org" target="_blank">OBIS</a> and
        <a href="https://gbif.org" target="_blank">GBIF</a>. The result is a single,
        queryable dataset covering the global ocean at H3 resolution 7 (cells ~15km across).
      </p>
      <p>
        The key insight is that traditional species distribution data lives in large, unwieldy
        occurrence tables. speciesgrids pre-aggregates this into a spatial grid format that can
        be queried in seconds from the cloud — no database server required, no data download,
        no infrastructure to manage.
      </p>

      <div class="callout blue">
        <div class="callout-icon">◈</div>
        <div>
          <strong>Serverless querying</strong> — This explorer runs DuckDB entirely in your
          browser (WebAssembly), reading data directly from S3 via HTTP range requests.
          No backend, no API, no rate limits.
        </div>
      </div>
    </section>

    <!-- Why it matters -->
    <section>
      <h2>Why it matters</h2>
      <div class="card-grid">
        <div class="card">
          <div class="card-icon">🌍</div>
          <h3>Global coverage</h3>
          <p>Covers all marine species in WoRMS with occurrences in OBIS or GBIF — hundreds of thousands of species, billions of records.</p>
        </div>
        <div class="card">
          <div class="card-icon">⚡</div>
          <h3>Instant queries</h3>
          <p>DuckDB's predicate pushdown reads only the relevant row groups from S3. Filtering by species name is fast even over the full dataset.</p>
        </div>
        <div class="card">
          <div class="card-icon">🔬</div>
          <h3>Research-ready</h3>
          <p>Aligned to WoRMS taxonomy, enriched with IUCN Red List status, and compatible with Python, R, QGIS, and any Parquet-aware tool.</p>
        </div>
        <div class="card">
          <div class="card-icon">🆓</div>
          <h3>Fully open</h3>
          <p>Data is publicly accessible on S3 without authentication. The code is MIT-licensed on GitHub. No account or API key required.</p>
        </div>
      </div>
    </section>

    <!-- Schema -->
    <section>
      <h2>Data schema</h2>
      <p>Each row in the dataset represents one species in one H3 cell:</p>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>cell</code></td><td>VARCHAR</td><td>H3 cell index at resolution 7 (~15km hexagons)</td></tr>
            <tr><td><code>species</code></td><td>VARCHAR</td><td>Species name (WoRMS aligned)</td></tr>
            <tr><td><code>genus</code></td><td>VARCHAR</td><td>Genus name</td></tr>
            <tr><td><code>family</code></td><td>VARCHAR</td><td>Family name</td></tr>
            <tr><td><code>class</code></td><td>VARCHAR</td><td>Class name</td></tr>
            <tr><td><code>phylum</code></td><td>VARCHAR</td><td>Phylum name</td></tr>
            <tr><td><code>kingdom</code></td><td>VARCHAR</td><td>Kingdom (Animalia, Plantae, etc.)</td></tr>
            <tr><td><code>records</code></td><td>BIGINT</td><td>Number of occurrence records in this cell</td></tr>
            <tr><td><code>AphiaID</code></td><td>INTEGER</td><td>WoRMS AphiaID (unique species identifier)</td></tr>
            <tr><td><code>date_start</code></td><td>DATE</td><td>Earliest observation date in this cell</td></tr>
            <tr><td><code>date_end</code></td><td>DATE</td><td>Latest observation date in this cell</td></tr>
            <tr><td><code>geometry</code></td><td>BLOB</td><td>H3 cell boundary as WKB geometry</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Data access -->
    <section>
      <h2>Data access</h2>
      <p>The full dataset is available on AWS S3 as partitioned Parquet files:</p>

      <div class="code-block">
        <div class="code-label">S3 path</div>
        <pre><code>s3://obis-products/speciesgrids/h3_7/</code></pre>
      </div>

      <div class="code-block">
        <div class="code-label">Download with AWS CLI (no credentials needed)</div>
        <pre><code>aws s3 cp --recursive s3://obis-products/speciesgrids/h3_7 . --no-sign-request</code></pre>
      </div>

      <div class="code-block">
        <div class="code-label">Query directly with DuckDB (Python)</div>
        <pre><code>import duckdb

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")

# Species distribution
df = con.execute("""
    SELECT cell, records
    FROM read_parquet('s3://obis-products/speciesgrids/h3_7/**/*.parquet')
    WHERE species = 'Gadus morhua'
""").df()
</code></pre>
      </div>

      <div class="code-block">
        <div class="code-label">Query with R + DuckDB</div>
        <pre><code>library(duckdb)
library(DBI)

con &lt;- dbConnect(duckdb())
dbExecute(con, "INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")

species_list &lt;- dbGetQuery(con, "
  SELECT DISTINCT species, genus, family
  FROM read_parquet('s3://obis-products/speciesgrids/h3_7/**/*.parquet')
  WHERE genus = 'Gadus'
  ORDER BY species
")
</code></pre>
      </div>

      <div class="code-block">
        <div class="code-label">Aggregate to coarser H3 resolution</div>
        <pre><code>-- H3 resolution 4 (~300km cells), total species richness
SELECT
    h3_cell_to_parent(cell, 4) AS cell_r4,
    COUNT(DISTINCT species)    AS species_richness
FROM read_parquet('s3://obis-products/speciesgrids/h3_7/**/*.parquet')
GROUP BY cell_r4
ORDER BY species_richness DESC
LIMIT 100;
</code></pre>
      </div>
    </section>

    <!-- H3 grid -->
    <section>
      <h2>The H3 grid system</h2>
      <p>
        speciesgrids uses Uber's <a href="https://h3geo.org" target="_blank">H3</a> hierarchical
        hexagonal grid. The native resolution is <strong>7</strong>, with cells approximately
        15km across (~600km²). Because H3 is hierarchical, you can aggregate to coarser
        resolutions using <code>h3_cell_to_parent(cell, resolution)</code> — both in DuckDB
        and in languages like Python and R.
      </p>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Resolution</th><th>Avg cell area</th><th>Avg cell width</th><th>Number of cells</th></tr></thead>
          <tbody>
            <tr><td>3</td><td>~12,393 km²</td><td>~130 km</td><td>41,162</td></tr>
            <tr><td>4</td><td>~1,770 km²</td><td>~49 km</td><td>288,122</td></tr>
            <tr><td>5</td><td>~253 km²</td><td>~19 km</td><td>2,016,842</td></tr>
            <tr><td>6</td><td>~36 km²</td><td>~7 km</td><td>14,117,882</td></tr>
            <tr class="highlight"><td><strong>7 ← native</strong></td><td>~5.2 km²</td><td>~2.7 km</td><td>98,825,162</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Use cases -->
    <section>
      <h2>Use cases</h2>
      <div class="usecase-list">
        <div class="usecase">
          <h3>🐟 Species distribution mapping</h3>
          <p>Visualise where any marine species has been observed, with record counts per grid cell. Immediately usable in mapping tools like QGIS, Lonboard, or this web explorer.</p>
        </div>
        <div class="usecase">
          <h3>🗺️ Biodiversity assessment</h3>
          <p>Compute species richness for any ocean area by filtering spatially. Combine with oceanographic variables for habitat suitability modelling.</p>
        </div>
        <div class="usecase">
          <h3>🚨 Biosecurity alerts</h3>
          <p>Powering the <a href="https://github.com/iobis/speedy" target="_blank">speedy</a> package, which combines speciesgrids with WoRMS distributions and thermal envelopes for the Pacific islands Marine bioinvasions Alert Network (PacMAN).</p>
        </div>
        <div class="usecase">
          <h3>📊 Trend analysis</h3>
          <p>Filter by date ranges to study temporal changes in species distributions. The <code>date_start</code>/<code>date_end</code> columns enable decade-by-decade comparisons.</p>
        </div>
      </div>
    </section>

    <!-- Citation -->
    <section>
      <h2>How to cite</h2>
      <p>If you use this data in your research, please cite all contributing sources:</p>
      <div class="citation-block">
        <p>OBIS (2024). speciesgrids (version 0.1.0). https://github.com/iobis/speciesgrids</p>
        <p>GBIF.org (1 May 2024) GBIF Occurrence Data https://doi.org/10.15468/dl.ubwn8z</p>
        <p>OBIS (25 October 2023) OBIS Occurrence Snapshot. Ocean Biodiversity Information System. Intergovernmental Oceanographic Commission of UNESCO. https://obis.org.</p>
        <p>World Register of Marine Species. Available from https://www.marinespecies.org at VLIZ. Accessed 2024-05-01. doi:10.14284/170.</p>
        <p>IUCN. 2023. The IUCN Red List of Threatened Species. Version 2023-1. https://www.iucnredlist.org.</p>
      </div>
    </section>

    <!-- Funding -->
    <section class="funding">
      <div class="eu-flag">🇪🇺</div>
      <p>
        Funded by the European Union under the Horizon Europe Programme,
        Grant Agreement No. 101112823 (<strong>DTO-BioFlow</strong>).
        Views and opinions expressed are those of the author(s) only and do not
        necessarily reflect those of the European Union or the European Research
        Executive Agency (REA).
      </p>
    </section>

  </main>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: #f0f4f8;
    color: #334155;
    font-family: 'IBM Plex Sans', sans-serif;
    overflow-y: auto;
  }

  /* ── Layout ──────────────────────────────────────────────────────────── */
  .page { min-height: 100vh; }

  nav {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 2rem;
    background: rgba(255,255,255,0.95);
    border-bottom: 1px solid #e2e8f0;
    backdrop-filter: blur(8px);
  }
  .back { font-size: 0.78rem; color: #64748b; text-decoration: none; transition: color 0.15s; }
  .back:hover { color: #0854a8; }
  .gh   { font-size: 0.72rem; color: #94a3b8; text-decoration: none; transition: color 0.15s; }
  .gh:hover { color: #0854a8; }

  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 3rem 2rem 5rem;
    display: flex;
    flex-direction: column;
    gap: 3.5rem;
  }

  /* ── Hero ────────────────────────────────────────────────────────────── */
  .hero { display: flex; flex-direction: column; gap: 1rem; }
  .hero-eyebrow {
    font-size: 0.7rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.14em;
    color: #0854a8;
  }
  h1 {
    font-size: 3rem; font-weight: 600; color: #0f172a;
    line-height: 1.1; letter-spacing: -0.02em;
    font-family: 'IBM Plex Sans', sans-serif;
  }
  .hero-sub {
    font-size: 1.05rem; color: #64748b;
    line-height: 1.6; max-width: 560px;
  }
  .hero-badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
  .badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.65rem; font-weight: 500;
    padding: 0.2rem 0.65rem;
    border-radius: 20px;
    border: 1px solid;
  }
  .badge.blue   { color: #0854a8; border-color: rgba(8,84,168,0.25);  background: rgba(8,84,168,0.06);  }
  .badge.green  { color: #16a34a; border-color: rgba(22,163,74,0.25); background: rgba(22,163,74,0.06); }
  .badge.purple { color: #7c3aed; border-color: rgba(124,58,237,0.25);background: rgba(124,58,237,0.06);}
  .badge.orange { color: #ea580c; border-color: rgba(234,88,12,0.25); background: rgba(234,88,12,0.06); }

  /* ── Sections ────────────────────────────────────────────────────────── */
  section { display: flex; flex-direction: column; gap: 1.25rem; }
  h2 {
    font-size: 1.35rem; font-weight: 600; color: #0f172a;
    border-bottom: 1px solid #e2e8f0;
    padding-bottom: 0.6rem;
  }
  p {
    font-size: 0.92rem; color: #475569; line-height: 1.75;
  }
  a { color: #0854a8; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Callout ─────────────────────────────────────────────────────────── */
  .callout {
    display: flex; gap: 1rem; align-items: flex-start;
    padding: 1rem 1.25rem;
    border-radius: 8px;
    font-size: 0.88rem; color: #475569; line-height: 1.65;
  }
  .callout.blue {
    background: rgba(8,84,168,0.05);
    border: 1px solid rgba(8,84,168,0.18);
  }
  .callout-icon { font-size: 1.2rem; color: #0854a8; flex-shrink: 0; margin-top: 0.1rem; }
  .callout strong { color: #0f172a; }

  /* ── Cards ───────────────────────────────────────────────────────────── */
  .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1.1rem;
    display: flex; flex-direction: column; gap: 0.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .card-icon { font-size: 1.4rem; }
  .card h3 { font-size: 0.88rem; font-weight: 600; color: #0f172a; }
  .card p   { font-size: 0.8rem; color: #64748b; line-height: 1.6; }

  /* ── Table ───────────────────────────────────────────────────────────── */
  .table-wrap {
    overflow-x: auto;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th {
    background: #f8fafc;
    color: #64748b; font-weight: 600; font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.07em;
    padding: 0.6rem 0.85rem; text-align: left;
    border-bottom: 1px solid #e2e8f0;
  }
  td {
    padding: 0.5rem 0.85rem;
    color: #475569;
    border-bottom: 1px solid #f1f5f9;
  }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f8fafc; }
  tr.highlight td { background: rgba(8,84,168,0.05); color: #0f172a; font-weight: 500; }
  code {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78em;
    color: #0854a8;
    background: rgba(8,84,168,0.07);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
  }

  /* ── Code blocks ─────────────────────────────────────────────────────── */
  .code-block {
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .code-label {
    background: #f8fafc;
    padding: 0.35rem 0.85rem;
    font-size: 0.62rem;
    color: #64748b;
    font-family: 'IBM Plex Mono', monospace;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #e2e8f0;
  }
  pre {
    background: #0f172a;
    padding: 0.85rem 1rem;
    overflow-x: auto;
    margin: 0;
  }
  pre code {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    color: #7dd3fc;
    background: none;
    padding: 0;
    border-radius: 0;
    line-height: 1.65;
    display: block;
  }

  /* ── Use cases ───────────────────────────────────────────────────────── */
  .usecase-list { display: flex; flex-direction: column; gap: 1.25rem; }
  .usecase {
    padding: 1rem 1.25rem;
    border-left: 3px solid rgba(8,84,168,0.3);
    background: #fff;
    border-radius: 0 7px 7px 0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .usecase h3 { font-size: 0.9rem; font-weight: 600; color: #0f172a; margin-bottom: 0.4rem; }
  .usecase p  { font-size: 0.82rem; color: #64748b; line-height: 1.65; }

  /* ── Citation ────────────────────────────────────────────────────────── */
  .citation-block {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    padding: 1rem 1.25rem;
    display: flex; flex-direction: column; gap: 0.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .citation-block p {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.72rem; color: #64748b;
    line-height: 1.6;
  }

  /* ── Funding ─────────────────────────────────────────────────────────── */
  .funding {
    flex-direction: row !important;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .eu-flag { font-size: 2rem; flex-shrink: 0; }
  .funding p { font-size: 0.8rem; color: #64748b; line-height: 1.65; }
  .funding strong { color: #334155; }
</style>
