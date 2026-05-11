<script lang="ts">
  /**
   * +page.svelte — OBIS Species Grid Explorer
   *
   * Three states:
   *   'overview' — loads local parquet on boot, no S3 query
   *   'species'  — S3 query filtered by species + year
   *   'area'     — S3 spatial query filtered by WKT/GeoJSON
   */
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { db, boot, loadOverview, runQuery, connection } from '$lib/db.svelte';
  import { buildSpeciesQuery, buildAreaQuery } from '$lib/buildQuery';
  import type { SpeciesControls, AreaControls } from '$lib/buildQuery';
  import SpeciesCombobox from '$lib/SpeciesCombobox.svelte';
  import type { CellRow } from '$lib/MapView.svelte';
  import { cellToLatLng } from 'h3-js';
  import ExploreTab from '$lib/ExploreTab.svelte';

  let MapView: any = $state(null);

  // ── View state ────────────────────────────────────────────────────────────
  type Tab = 'overview' | 'species' | 'area' | 'explore';
  let activeTab   = $state<Tab>('overview');
  let rows        = $state<CellRow[]>([]);
  let loading     = $state(false);
  let error       = $state<string|null>(null);
  let metricLabel = $state('species');
  let bbox        = $state<[[number,number],[number,number]] | null>(null);
  let showDownloadPopup = $state(false);

  // ── Explore state ─────────────────────────────────────────────────────────
  const S3 = `'s3://obis-products/speciesgrids/h3_7/*'`;

  interface ExploreQuery {
    id: string; title: string; description: string; sql: string;
    statLabel: string; statFn: (rows: any[]) => string;
  }

  const EXPLORE_QUERIES: ExploreQuery[] = [
    {
      id: 'rare-species', title: 'Rare species',
      description: 'Species with fewer than 5 total occurrence records — the rarest observations in the dataset.',
      sql: `SELECT species, AphiaID, SUM(records)::INTEGER AS total_records, COUNT(*)::INTEGER AS total_cells, MAX(max_year)::INTEGER AS last_seen\nFROM read_parquet(${S3})\nGROUP BY species, AphiaID\nHAVING SUM(records) < 5\nORDER BY total_records ASC, species ASC`,
      statLabel: 'species with < 5 records',
      statFn: r => fmtN(r.length) //+ (r.length === 500 ? '+' : ''),
    },
    {
      id: 'lost-species', title: 'Lost species',
      description: 'Species with no recorded observation after 1965 — potentially data-deficient, range-shifted, or locally extinct.',
      sql: `SELECT species, AphiaID, MAX(max_year)::INTEGER AS last_seen, SUM(records)::INTEGER AS total_records, COUNT(*)::INTEGER AS total_cells\nFROM read_parquet(${S3})\nGROUP BY species, AphiaID\nHAVING MAX(max_year) <= 1965\nORDER BY last_seen ASC, total_records DESC`,
      statLabel: 'species last seen before 1965',
      statFn: r => fmtN(r.length) //+ (r.length === 500 ? '+' : ''),
    },
    {
      id: 'blue-whale', title: 'Blue whale (Balaenoptera musculus)',
      description: 'All H3 cells where the blue whale has been observed, with record counts and observation time range.',
      sql: `SELECT cell, records AS record_count, min_year, max_year\nFROM read_parquet(${S3})\nWHERE species = 'Balaenoptera musculus'\nORDER BY records DESC`,
      statLabel: 'total occurrence records',
      statFn: r => fmtN(r.reduce((s: number, row: any) => s + Number(row.record_count), 0)),
    },
    {
      id: 'top-places', title: 'Top 100 places',
      description: 'The 100 H3 resolution-4 cells (~300 km) with the most occurrence records.',
      sql: `SELECT h3_cell_to_parent(cell, 4) AS cell_r4, SUM(records)::BIGINT AS total_records, COUNT(DISTINCT species)::INT AS total_species\nFROM read_parquet(${S3})\nGROUP BY cell_r4\nORDER BY total_records DESC\nLIMIT 100`,
      statLabel: 'top cells by records',
      statFn: r => fmtN(r.length),
    },
  ];

  type ExploreState = 'idle' | 'running' | 'done' | 'error';
  let exploreStates   = $state<Record<string, ExploreState>>(Object.fromEntries(EXPLORE_QUERIES.map(q => [q.id, 'idle'])));
  let exploreResults  = $state<Record<string, any[]>>(Object.fromEntries(EXPLORE_QUERIES.map(q => [q.id, []])));
  let exploreErrors   = $state<Record<string, string>>(Object.fromEntries(EXPLORE_QUERIES.map(q => [q.id, ''])));
  let activeExploreId = $state<string | null>(null);
  let expandedCards   = $state<Set<string>>(new Set());

  function toggleCard(id: string) {
    const s = new Set(expandedCards);
    if (s.has(id)) s.delete(id); else s.add(id);
    expandedCards = s;
  }

  async function runExplore(q: ExploreQuery) {
    if (!connection) return;
    activeExploreId      = q.id;
    exploreStates[q.id]  = 'running';
    exploreErrors[q.id]  = '';
    exploreResults[q.id] = [];
    try {
      const result = await connection.query(q.sql);
      const cols   = result.schema.fields.map((f: any) => f.name);
      exploreResults[q.id] = result.toArray().map((row: any) =>
        Object.fromEntries(cols.map((c: string) => [c, row[c]]))
      );
      exploreStates[q.id] = 'done';
    } catch(e) {
      exploreErrors[q.id]  = String(e);
      exploreStates[q.id]  = 'error';
    }
  }

  function downloadExploreCSV() {
    if (!activeExploreId) return;
    const rows = exploreResults[activeExploreId];
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const header = cols.join(',');
    const body   = rows.map(r =>
      cols.map(c => {
        const v = String(r[c] ?? '');
        return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')
    ).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `obis_${activeExploreId}_${Date.now()}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function fmtN(n: number): string {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return n.toLocaleString();
  }

  // Derived props for the ExploreTab result panel
  const activeExploreQuery = $derived(() => EXPLORE_QUERIES.find(q => q.id === activeExploreId) ?? null);
  const activeExploreRows  = $derived(() => activeExploreId ? exploreResults[activeExploreId] : []);
  const activeExploreCols  = $derived(() => activeExploreRows().length ? Object.keys(activeExploreRows()[0]) : []);
  const activeExploreStat  = $derived(() => {
    const q = activeExploreQuery();
    if (!q || exploreStates[q.id] !== 'done') return '';
    return q.statFn(exploreResults[q.id]);
  });

  // ── Species tab controls ──────────────────────────────────────────────────
  let speciesControls = $state<SpeciesControls>({
    species:      '',
    yearMin:      null,
    yearMax:      null,
    h3Resolution: 7,
  });

  // ── Area tab controls ─────────────────────────────────────────────────────
  let areaControls = $state<AreaControls>({
    wkt:          '',
    metric:       'species',
    h3Resolution: 4,
    yearMin:      null,
    yearMax:      null,
  });
  let geojsonError = $state<string|null>(null);

  // ── SQL display (derived live from controls) ──────────────────────────────
  const previewSQL = $derived(() => {
    if (activeTab === 'species' && speciesControls.species)
      return buildSpeciesQuery(speciesControls);
    if (activeTab === 'area' && areaControls.wkt)
      return buildAreaQuery(areaControls);
    return '-- Select a tab and fill in the controls above,\n-- then click Run to execute.';
  });

  // ── Year range helpers ────────────────────────────────────────────────────
  const THIS_YEAR = new Date().getFullYear();
  const YEARS = Array.from({length: THIS_YEAR - 1850 + 1}, (_, i) => THIS_YEAR - i);

  // ── H3 resolution options ─────────────────────────────────────────────────
  const H3_OPTS = [
    {v:3,km:'~700km'},{v:4,km:'~300km'},{v:5,km:'~110km'},
    {v:6,km:'~40km'},{v:7,km:'~15km'},
  ] as const;

  // ── OBIS taxon lookup ─────────────────────────────────────────────────────
  // Called whenever the species selection changes. Fetches the AphiaID/taxonID
  // from the OBIS API so we can show a direct link to the taxon page.
  interface OBISTaxon {
    taxonID:        number;
    scientificName: string;
    taxonRank:      string;
    taxonomicStatus: string;
  }

  let taxon        = $state<OBISTaxon | null>(null);
  let taxonLoading = $state(false);
  let lastLookedUp = ''; // avoid redundant fetches on re-renders

  async function lookupTaxon(name: string) {
    if (!name.trim() || name === lastLookedUp) return;
    lastLookedUp = name;
    taxon        = null;
    taxonLoading = true;
    try {
      const res  = await fetch(`https://api.obis.org/v3/taxon/${encodeURIComponent(name)}`);
      const data = await res.json();
      taxon = data.results?.[0] ?? null;
    } catch {
      taxon = null;
    } finally {
      taxonLoading = false;
    }
  }

  // Watch species selection and trigger lookup
  // REMOVED: $effect here would fire on every keystroke as the user types.
  // Instead, lookupTaxon() is called from the SpeciesCombobox onSelect callback,
  // which only fires when the user explicitly picks an item from the dropdown.
  // cellToLatLng is a pure lookup (no geometry decoding) — fast even for
  // thousands of cells. We sample at most 2000 to keep it instant.
  function bboxFromCells(cellRows: CellRow[]): [[number,number],[number,number]] | null {
    if (!cellRows.length) return null;
    const sample = cellRows.length > 2000
      ? cellRows.filter((_, i) => i % Math.ceil(cellRows.length / 2000) === 0)
      : cellRows;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const r of sample) {
      const [lat, lng] = cellToLatLng(r.cell);
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    return [[minLng, minLat], [maxLng, maxLat]];
  }

  async function runSpecies() {
    if (!speciesControls.species.trim()) return;
    loading = true; error = null; bbox = null;
    metricLabel = 'records';
    try {
      const raw = await runQuery(buildSpeciesQuery(speciesControls));
      rows = raw.map(r => ({ cell: String(r.cell), value: Number(r.value) }));
      bbox = bboxFromCells(rows);
    } catch(e) { error = String(e); rows = []; }
    finally { loading = false; }
  }

  async function runArea() {
    if (!areaControls.wkt.trim()) return;
    loading = true; error = null; bbox = null;
    metricLabel = areaControls.metric === 'species' ? 'species' : 'records';
    try {
      const raw = await runQuery(buildAreaQuery(areaControls));
      rows = raw.map(r => ({ cell: String(r.cell), value: Number(r.value) }));
      bbox = bboxFromCells(rows);
    } catch(e) { error = String(e); rows = []; }
    finally { loading = false; }
  }

  // ── GeoJSON upload → extract WKT ─────────────────────────────────────────
  function handleGeoJSONUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    geojsonError = null;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const geojson = JSON.parse(ev.target?.result as string);
        // Extract first geometry from FeatureCollection or Feature
        let geom = geojson;
        if (geojson.type === 'FeatureCollection') geom = geojson.features[0]?.geometry;
        if (geojson.type === 'Feature') geom = geojson.geometry;
        if (!geom) throw new Error('No geometry found');

        // Convert GeoJSON geometry → WKT (simple implementation for Polygon/MultiPolygon)
        areaControls.wkt = geomToWKT(geom);
      } catch(err) {
        geojsonError = `Could not parse GeoJSON: ${err}`;
      }
    };
    reader.readAsText(file);
  }

  function geomToWKT(geom: any): string {
    function coordStr(coords: number[]): string {
      return coords.join(' ');
    }
    function ringStr(ring: number[][]): string {
      return `(${ring.map(coordStr).join(', ')})`;
    }
    if (geom.type === 'Polygon') {
      return `POLYGON (${geom.coordinates.map(ringStr).join(', ')})`;
    }
    if (geom.type === 'MultiPolygon') {
      const polys = geom.coordinates.map((poly: number[][][]) =>
        `(${poly.map(ringStr).join(', ')})`
      );
      return `MULTIPOLYGON (${polys.join(', ')})`;
    }
    if (geom.type === 'Point') {
      return `POINT (${geom.coordinates.join(' ')})`;
    }
    throw new Error(`Unsupported geometry type: ${geom.type}`);
  }

  // ── Download JSONL ────────────────────────────────────────────────────────
  function download() {
    if (!rows.length) return;
    const blob = new Blob([rows.map(r=>JSON.stringify(r)).join('\n')],
                          {type:'application/x-ndjson'});
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `obis_${activeTab}_${Date.now()}.jsonl`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showDownloadPopup = true;
  }

  // ── Copy SQL ──────────────────────────────────────────────────────────────
  let copied = $state(false);
  function copySQL() {
    navigator.clipboard.writeText(previewSQL());
    copied = true;
    setTimeout(() => copied = false, 1500);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  onMount(async () => {
    if (!browser) return;
    MapView = (await import('$lib/MapView.svelte')).default;
    await boot();
    // Load local overview parquet immediately — no S3 needed
    loading = true;
    metricLabel = 'species';
    try {
      const overviewRows = await loadOverview();
      rows = overviewRows.map(r => ({ cell: r.cell, value: r.total_species }));
    } catch(e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  function fmt(n:number) {
    if(n>=1e6) return (n/1e6).toFixed(1)+'M';
    if(n>=1e3) return (n/1e3).toFixed(1)+'k';
    return n.toLocaleString();
  }
</script>

<svelte:head>
  <title>OBIS Species Grid Explorer</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.0.0/dist/maplibre-gl.css"/>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
</svelte:head>

<div class="layout">

  <!-- ════════════════ SIDEBAR ════════════════ -->
  <aside class="sidebar">

    <!-- Brand + nav -->
    <div class="brand">
      <span class="logo"><span style="font-weight: bold;">speciesgrids</span> explorer</span>
      <a href="/docs" class="docs-link">Docs ↗</a>
    </div>

    <!-- DuckDB status -->
    <div class="db-status" data-s={db.status}>
      <span class="dot"></span>
      {#if db.status === 'booting'}  Connecting to DuckDB…
      {:else if db.status === 'ready' && !db.speciesLoaded} Ready · indexing species…
      {:else if db.status === 'ready'} {fmt(db.speciesList.length)} species indexed
      {:else if db.status === 'error'} {db.error}
      {:else} Idle
      {/if}
    </div>

    <!-- ── Tab switcher ────────────────────────────────── -->
    <div class="tabs">
      <button class:active={activeTab==='overview'} onclick={() => activeTab='overview'}>
        Overview
      </button>
      <button class:active={activeTab==='species'} onclick={() => activeTab='species'}>
        Species
      </button>
      <button class:active={activeTab==='area'} onclick={() => activeTab='area'}>
        Area
      </button>
      <button class:active={activeTab==='explore'} onclick={() => activeTab='explore'}>
        Explore
      </button>
    </div>

    <!-- ════ OVERVIEW TAB ════ -->
    {#if activeTab === 'overview'}
      <div class="tab-body">
        <p class="tab-desc">
          Global overview showing the number of distinct marine species
          observed per H3 resolution-4 cell (~300 km), loaded from a
          pre-aggregated local file.
        </p>
        <div class="stat-pill">
          {rows.length ? fmt(rows.length)+' cells loaded' : 'Loading…'}
        </div>
        <p class="hint">
          Switch to the <strong>Species</strong> tab to query a specific
          taxon, or <strong>Area</strong> to filter by geometry.
        </p>
      </div>

    <!-- ════ SPECIES TAB ════ -->
    {:else if activeTab === 'species'}
      <div class="tab-body">

        <div class="field">
          <label class="field-label">Species <span class="req">*</span></label>
          <SpeciesCombobox
            bind:value={speciesControls.species}
            onSelect={(s) => {
              if (s) lookupTaxon(s);
              else { taxon = null; lastLookedUp = ''; }
            }}
          />
          {#if speciesControls.species}
            {#if taxonLoading}
              <span class="taxon-loading">Looking up taxon…</span>
            {:else if taxon}
              <a
                class="obis-species-link"
                href="https://obis.org/taxon/{taxon.taxonID}"
                target="_blank"
                rel="noopener"
              >
                <em>{taxon.scientificName}</em>
                <span class="taxon-id">AphiaID {taxon.taxonID}</span>
                <span class="taxon-arrow">↗</span>
              </a>
            {:else if !taxonLoading}
              <span class="taxon-not-found">Species not found in OBIS</span>
            {/if}
          {/if}
        </div>

        <div class="field">
          <label class="field-label">Year range</label>
          <div class="year-row">
            <select bind:value={speciesControls.yearMin}>
              <option value={null}>From…</option>
              {#each YEARS as y}<option value={y}>{y}</option>{/each}
            </select>
            <span class="year-sep">–</span>
            <select bind:value={speciesControls.yearMax}>
              <option value={null}>To…</option>
              {#each YEARS as y}<option value={y}>{y}</option>{/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label">H3 resolution</label>
          <div class="res-grid">
            {#each H3_OPTS as o}
              <button
                class="res-btn"
                class:active={speciesControls.h3Resolution === o.v}
                onclick={() => speciesControls.h3Resolution = o.v}
              >
                <span class="res-n">{o.v}</span>
                <span class="res-k">{o.km}</span>
              </button>
            {/each}
          </div>
        </div>

        <button
          class="run-btn"
          onclick={runSpecies}
          disabled={!speciesControls.species || db.status!=='ready' || loading}
        >
          {loading ? '⟳ Querying…' : '▶ Run'}
        </button>

        {#if rows.length > 0 && activeTab === 'species'}
          <div class="result-row">
            <span class="result-count">{fmt(rows.length)} cells</span>
            <button class="dl-btn" onclick={download}>↓ Download</button>
          </div>
        {/if}

      </div>

    <!-- ════ AREA TAB ════ -->
    {:else if activeTab === 'area'}
      <div class="tab-body">

        <div class="field">
          <label class="field-label">WKT geometry</label>
          <textarea
            bind:value={areaControls.wkt}
            placeholder="POLYGON ((lng lat, lng lat, …))"
            rows={4}
            spellcheck="false"
          ></textarea>
        </div>

        <div class="field">
          <label class="field-label">Or upload GeoJSON</label>
          <label class="file-upload">
            <input type="file" accept=".geojson,.json" onchange={handleGeoJSONUpload}/>
            <span>Choose file…</span>
          </label>
          {#if areaControls.wkt && !geojsonError}
            <p class="ok-hint">✓ Geometry loaded</p>
          {/if}
          {#if geojsonError}
            <p class="err-hint">{geojsonError}</p>
          {/if}
        </div>

        <div class="field">
          <label class="field-label">Metric</label>
          <div class="seg">
            <button class:active={areaControls.metric==='species'}
              onclick={() => areaControls.metric='species'}># species</button>
            <button class:active={areaControls.metric==='records'}
              onclick={() => areaControls.metric='records'}># records</button>
          </div>
        </div>

        <div class="field">
          <label class="field-label">Year range</label>
          <div class="year-row">
            <select bind:value={areaControls.yearMin}>
              <option value={null}>From…</option>
              {#each YEARS as y}<option value={y}>{y}</option>{/each}
            </select>
            <span class="year-sep">–</span>
            <select bind:value={areaControls.yearMax}>
              <option value={null}>To…</option>
              {#each YEARS as y}<option value={y}>{y}</option>{/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label">H3 resolution</label>
          <div class="res-grid">
            {#each H3_OPTS as o}
              <button
                class="res-btn"
                class:active={areaControls.h3Resolution === o.v}
                onclick={() => areaControls.h3Resolution = o.v}
              >
                <span class="res-n">{o.v}</span>
                <span class="res-k">{o.km}</span>
              </button>
            {/each}
          </div>
        </div>

        <button
          class="run-btn"
          onclick={runArea}
          disabled={!areaControls.wkt || db.status!=='ready' || loading}
        >
          {loading ? '⟳ Querying…' : '▶ Run'}
        </button>

        {#if rows.length > 0 && activeTab === 'area'}
          <div class="result-row">
            <span class="result-count">{fmt(rows.length)} cells</span>
            <button class="dl-btn" onclick={download}>↓ Download</button>
          </div>
        {/if}

      </div>
    {/if}

    <!-- ════ EXPLORE TAB — sidebar has query cards ════ -->
    {#if activeTab === 'explore'}
      <div class="explore-cards">
        {#each EXPLORE_QUERIES as q}
          {@const state     = exploreStates[q.id]}
          {@const expanded  = expandedCards.has(q.id)}
          {@const isActive  = activeExploreId === q.id}
          <div class="explore-card" class:active={isActive}>
            <!-- Card header: always visible -->
            <button class="card-toggle" onclick={() => toggleCard(q.id)}>
              <span class="card-title">{q.title}</span>
              <span class="card-chevron">{expanded ? '▲' : '▼'}</span>
            </button>

            <!-- Collapsed body -->
            {#if expanded}
              <div class="card-body">
                <p class="card-desc">{q.description}</p>
                <pre class="card-sql">{q.sql}</pre>
                <button
                  class="card-run"
                  onclick={() => runExplore(q)}
                  disabled={state === 'running'}
                >
                  {state === 'running' ? '⟳ Running…' : state === 'done' ? '↺ Re-run' : '▶ Run query'}
                </button>
                {#if state === 'done'}
                  <p class="card-result-hint">
                    {exploreResults[q.id].length.toLocaleString()} rows →
                    <button class="view-btn" onclick={() => { activeExploreId = q.id; }}>
                      View results
                    </button>
                  </p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <div class="sidebar-footer">
      <a href="/docs">Documentation</a> ·
      <a href="https://obis.org" target="_blank" rel="noopener">obis.org</a> ·
      <a href="https://github.com/iobis/speciesgrids" target="_blank" rel="noopener">GitHub</a>
    </div>

  </aside>

  <!-- ════════════════ MAIN ════════════════ -->
  <div class="main">

    <!-- Explore panel — shown instead of map -->
    {#if activeTab === 'explore'}
      <div class="explore-wrap">
        <ExploreTab
          title={activeExploreQuery()?.title ?? ''}
          statNumber={activeExploreStat()}
          statLabel={activeExploreQuery()?.statLabel ?? ''}
          cols={activeExploreCols()}
          rows={activeExploreRows()}
          loading={!!activeExploreId && exploreStates[activeExploreId] === 'running'}
          error={activeExploreId ? exploreErrors[activeExploreId] : ''}
          onDownload={downloadExploreCSV}
        />
      </div>

    <!-- Map + SQL panel -->
    {:else}
    <div class="map-wrap">
      {#if MapView}
        <svelte:component
          this={MapView}
          {rows}
          {loading}
          {metricLabel}
          outlineWKT={activeTab === 'area' ? areaControls.wkt : ''}
          {bbox}
        />
      {:else}
        <div class="init-screen">
          <div class="init-spin"></div>
          <span>Initialising…</span>
        </div>
      {/if}

      <!-- Overview badge -->
      {#if activeTab === 'overview' && rows.length > 0}
        <div class="map-badge">
          H3 res-4 · species richness · {fmt(rows.length)} cells
        </div>
      {/if}

      {#if error}
        <div class="error-toast">{error}</div>
      {/if}
    </div>

    <!-- Download tip popup -->
    {#if showDownloadPopup}
      <div class="popup-backdrop" onclick={() => showDownloadPopup = false}>
        <div class="popup" onclick={(e) => e.stopPropagation()}>
          <div class="popup-icon">◈</div>
          <h3>Download started</h3>
          <p>
            You're downloading a snapshot of this query's results. But speciesgrids
            has a lot more to offer — you can query any species, filter by taxonomy,
            join with WoRMS, and run spatial queries directly against the full dataset
            on S3 using DuckDB, Python, or R. No download required.
          </p>
          <p>
            See the <a href="/docs" onclick={() => showDownloadPopup = false}>documentation</a> for
            code examples and the complete data schema.
          </p>
          <button class="popup-close" onclick={() => showDownloadPopup = false}>Got it</button>
        </div>
      </div>
    {/if}

    <!-- SQL panel -->
    <div class="sql-panel">
      <div class="sql-header">
        <span class="sql-label">SQL</span>
        <span class="sql-sub">
          {activeTab === 'overview'
            ? 'overview loaded from local parquet'
            : loading ? 'running…'
            : rows.length ? `${fmt(rows.length)} rows`
            : 'preview — not yet run'}
        </span>
        <button class="copy-btn" onclick={copySQL}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <textarea class="sql-box" readonly value={
        activeTab === 'overview'
          ? `-- Overview loaded from static/overview_h3_4.parquet (local file)\n-- Generated by: python generate_overview.py\nSELECT cell, total_species\nFROM read_parquet('overview_h3_4.parquet')`
          : previewSQL()
      } rows={6} spellcheck="false"></textarea>
    </div>

    {/if}<!-- end map/sql vs explore -->

  </div>
</div>

<style>
  :global(*,*::before,*::after){box-sizing:border-box;margin:0;padding:0}
  :global(body){
    background:#f0f4f8; color:#1e293b;
    font-family:'IBM Plex Sans',sans-serif; overflow:hidden;
  }

  .layout { display:flex; height:100vh; width:100vw; }

  /* ── Explore panel ─────────────────────────────────────────────────── */
  .explore-wrap {
    flex: 1;
    background: #f0f4f8;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ── Sidebar ──────────────────────────────────────────────────────── */
  .sidebar {
    width:272px; min-width:272px; height:100vh;
    background:#ffffff;
    border-right:1px solid #e2e8f0;
    display:flex; flex-direction:column;
    overflow-y:auto; overflow-x:hidden;
    scrollbar-width:thin; scrollbar-color:rgba(0,0,0,.08) transparent;
    font-family:'IBM Plex Mono',monospace; font-size:.78rem;
  }

  .brand {
    display:flex; align-items:center; justify-content:space-between;
    padding:.85rem 1rem .7rem;
    border-bottom:1px solid #e2e8f0;
  }
  .logo { font-size:.9rem; color:#0854a8; letter-spacing:.02em; }
  .docs-link { font-size:.62rem; color:#94a3b8; text-decoration:none; }
  .docs-link:hover { color:#0854a8; }

  .db-status {
    display:flex; align-items:center; gap:.4rem;
    padding:.35rem 1rem; font-size:.62rem; color:#94a3b8;
    border-bottom:1px solid #f1f5f9;
  }
  .db-status[data-s="ready"]   { color:#16a34a; }
  .db-status[data-s="booting"] { color:#0854a8; }
  .db-status[data-s="error"]   { color:#dc2626; }
  .dot { width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0; }
  .db-status[data-s="ready"] .dot { animation:blink 2.5s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }

  /* Tabs */
  .tabs {
    display:flex; border-bottom:1px solid #e2e8f0;
  }
  .tabs button {
    flex:1; padding:.52rem .2rem;
    background:none; border:none; border-bottom:2px solid transparent;
    color:#94a3b8; font-family:inherit; font-size:.62rem; font-weight:600;
    cursor:pointer; text-transform:uppercase; letter-spacing:.07em;
    transition:all .15s;
  }
  .tabs button.active { color:#0854a8; border-bottom-color:#0854a8; }
  .tabs button:hover:not(.active) { color:#475569; }

  /* Tab body */
  .tab-body {
    padding:.85rem 1rem;
    display:flex; flex-direction:column; gap:.75rem;
    flex:1;
  }

  .tab-desc { font-size:.72rem; color:#64748b; line-height:1.55; font-family:'IBM Plex Sans',sans-serif; }
  .hint { font-size:.67rem; color:#94a3b8; line-height:1.5; font-family:'IBM Plex Sans',sans-serif; }
  .hint strong { color:#64748b; }

  .stat-pill {
    font-size:.7rem; color:#16a34a;
    background:rgba(22,163,74,.06);
    border:1px solid rgba(22,163,74,.2);
    border-radius:20px; padding:.22rem .7rem; width:fit-content;
  }

  /* Fields */
  .field { display:flex; flex-direction:column; gap:.3rem; }
  .field-label {
    font-size:.58rem; font-weight:600;
    text-transform:uppercase; letter-spacing:.12em; color:#94a3b8;
  }
  .req { color:#dc2626; }

  textarea {
    background:#f8fafc;
    border:1px solid #e2e8f0;
    border-radius:6px; color:#334155;
    font-family:'IBM Plex Mono',monospace; font-size:.72rem;
    padding:.45rem .6rem; resize:vertical; outline:none; line-height:1.5;
  }
  textarea:focus { border-color:rgba(8,84,168,.4); }

  /* Year selects */
  .year-row { display:flex; align-items:center; gap:.4rem; }
  .year-sep { color:#cbd5e1; font-size:.8rem; flex-shrink:0; }
  .year-row select {
    flex:1; background:#f8fafc;
    border:1px solid #e2e8f0; border-radius:5px;
    color:#334155; font-family:inherit; font-size:.72rem;
    padding:.32rem .4rem; outline:none;
  }
  .year-row select:focus { border-color:rgba(8,84,168,.35); }

  /* H3 resolution grid */
  .res-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:.25rem; }
  .res-btn {
    display:flex; flex-direction:column; align-items:center;
    padding:.35rem .15rem; border-radius:5px;
    border:1px solid #e2e8f0;
    background:#f8fafc;
    cursor:pointer; gap:.1rem; transition:all .15s;
  }
  .res-btn.active { border-color:rgba(8,84,168,.4); background:rgba(8,84,168,.07); }
  .res-n { font-size:.82rem; font-weight:600; color:#94a3b8; }
  .res-btn.active .res-n { color:#0854a8; }
  .res-k { font-size:.48rem; color:#cbd5e1; text-align:center; line-height:1.2; }

  /* Metric seg */
  .seg {
    display:flex; border-radius:6px;
    border:1px solid #e2e8f0; overflow:hidden;
  }
  .seg button {
    flex:1; padding:.38rem .4rem; background:none; border:none;
    color:#94a3b8; font-size:.7rem; cursor:pointer; font-family:inherit; transition:all .15s;
  }
  .seg button.active { background:rgba(8,84,168,.07); color:#0854a8; }
  .seg button+button { border-left:1px solid #e2e8f0; }

  /* File upload */
  .file-upload {
    position:relative; display:inline-flex; align-items:center;
    cursor:pointer;
  }
  .file-upload input[type="file"] {
    position:absolute; inset:0; opacity:0; cursor:pointer; width:100%;
  }
  .file-upload span {
    display:block; width:100%;
    padding:.38rem .65rem;
    background:#f8fafc;
    border:1px dashed #cbd5e1;
    border-radius:5px; font-size:.72rem; color:#94a3b8;
    transition:border-color .15s;
  }
  .file-upload:hover span { border-color:#0854a8; color:#475569; }

  .ok-hint  { font-size:.65rem; color:#16a34a; }
  .err-hint { font-size:.65rem; color:#dc2626; }

  .obis-species-link {
    display: inline-flex;
    align-items: center;
    gap: .35rem;
    font-size: .68rem;
    color: #0854a8;
    text-decoration: none;
    font-family: 'IBM Plex Mono', monospace;
    padding: .25rem .5rem;
    background: rgba(8,84,168,.05);
    border: 1px solid rgba(8,84,168,.18);
    border-radius: 5px;
    transition: all .15s;
  }
  .obis-species-link:hover {
    background: rgba(8,84,168,.12);
    text-decoration: none;
  }
  .obis-species-link em { font-style: italic; color: #0f172a; }
  .taxon-id {
    font-size: .6rem;
    color: #64748b;
    background: #e2e8f0;
    padding: .05rem .3rem;
    border-radius: 3px;
  }
  .taxon-arrow { color: #94a3b8; font-style: normal; }
  .taxon-loading { font-size: .62rem; color: #94a3b8; font-family: 'IBM Plex Mono', monospace; }
  .taxon-not-found { font-size: .62rem; color: #94a3b8; font-family: 'IBM Plex Mono', monospace; font-style: italic; }

  /* Run button */
  .run-btn {
    width:100%; padding:.52rem;
    background:#0854a8; border:none;
    border-radius:7px; color:#fff;
    font-family:inherit; font-size:.8rem; font-weight:600;
    cursor:pointer; transition:background .15s;
  }
  .run-btn:hover:not(:disabled) { background:#0a6fd4; }
  .run-btn:disabled { opacity:.4; cursor:not-allowed; }

  /* Result row */
  .result-row {
    display:flex; align-items:center; justify-content:space-between; gap:.5rem;
  }
  .result-count { font-size:.68rem; color:#16a34a; }
  .dl-btn {
    padding:.28rem .75rem;
    background:rgba(22,163,74,.07); border:1px solid rgba(22,163,74,.25);
    border-radius:5px; color:#16a34a;
    font-family:inherit; font-size:.68rem; font-weight:600;
    cursor:pointer; transition:background .15s;
  }
  .dl-btn:hover { background:rgba(22,163,74,.14); }

  /* Footer */
  /* ── Explore sidebar cards ──────────────────────────────────────────── */
  .explore-cards {
    display: flex;
    flex-direction: column;
    padding: .6rem .75rem;
    gap: .4rem;
    flex: 1;
    overflow-y: auto;
  }

  .explore-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
    transition: border-color .15s;
  }
  .explore-card.active { border-color: #0854a8; }

  .card-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .55rem .75rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    gap: .5rem;
    font-family: 'IBM Plex Mono', monospace;
  }
  .card-toggle:hover { background: #f8fafc; }

  .card-title {
    font-size: .72rem;
    font-weight: 600;
    color: #334155;
  }
  .explore-card.active .card-title { color: #0854a8; }

  .card-chevron {
    font-size: .5rem;
    color: #94a3b8;
    flex-shrink: 0;
  }

  .card-body {
    padding: .6rem .75rem .75rem;
    border-top: 1px solid #f1f5f9;
    display: flex;
    flex-direction: column;
    gap: .5rem;
  }

  .card-desc {
    font-size: .67rem;
    color: #64748b;
    line-height: 1.5;
    margin: 0;
    font-family: 'IBM Plex Sans', sans-serif;
  }

  .card-sql {
    font-family: 'IBM Plex Mono', monospace;
    font-size: .58rem;
    color: #94a3b8;
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 5px;
    padding: .45rem .55rem;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
    margin: 0;
    line-height: 1.55;
  }

  .card-run {
    width: 100%;
    padding: .4rem;
    background: #0854a8;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: .7rem;
    font-weight: 600;
    font-family: 'IBM Plex Mono', monospace;
    cursor: pointer;
    transition: background .15s;
  }
  .card-run:hover:not(:disabled) { background: #0a6fd4; }
  .card-run:disabled { opacity: .4; cursor: not-allowed; }

  .card-result-hint {
    font-size: .63rem;
    color: #94a3b8;
    margin: 0;
    display: flex;
    align-items: center;
    gap: .35rem;
    font-family: 'IBM Plex Mono', monospace;
  }

  .view-btn {
    background: none;
    border: none;
    color: #0854a8;
    font-size: .63rem;
    font-family: 'IBM Plex Mono', monospace;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .sidebar-footer {
    margin-top:auto; padding:.85rem 1rem;
    font-size:.58rem; color:#cbd5e1; line-height:2;
    border-top:1px solid #f1f5f9;
  }
  .sidebar-footer a { color:#94a3b8; text-decoration:none; }
  .sidebar-footer a:hover { color:#0854a8; }

  /* ── Main ──────────────────────────────────────────────────────────── */
  .main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .map-wrap { flex:1; position:relative; overflow:hidden; }

  .init-screen {
    position:absolute; inset:0;
    display:flex; align-items:center; justify-content:center;
    gap:.75rem; color:#94a3b8; font-size:.8rem;
  }
  .init-spin {
    width:24px; height:24px;
    border:2px solid #e2e8f0; border-top-color:#0854a8;
    border-radius:50%; animation:spin .9s linear infinite;
  }
  @keyframes spin { to{transform:rotate(360deg)} }

  .map-badge {
    position:absolute; top:.75rem; left:50%;
    transform:translateX(-50%);
    background:rgba(255,255,255,.92);
    border:1px solid #e2e8f0;
    border-radius:20px; padding:.3rem .9rem;
    font-family:'IBM Plex Mono',monospace; font-size:.65rem; color:#64748b;
    pointer-events:none;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
  }

  .error-toast {
    position:absolute; bottom:1.5rem; left:50%; transform:translateX(-50%);
    background:rgba(220,38,38,.07); border:1px solid rgba(220,38,38,.25);
    border-radius:7px; padding:.55rem 1.25rem;
    font-size:.72rem; color:#dc2626; max-width:480px; text-align:center;
    font-family:'IBM Plex Mono',monospace;
  }

  /* ── SQL panel ─────────────────────────────────────────────────────── */
  .sql-panel {
    height:160px; min-height:160px;
    border-top:1px solid #e2e8f0;
    background:#f8fafc;
    display:flex; flex-direction:column;
  }
  .sql-header {
    display:flex; align-items:center; gap:.6rem;
    padding:.4rem .85rem;
    border-bottom:1px solid #e2e8f0;
  }
  .sql-label {
    font-family:'IBM Plex Mono',monospace; font-size:.58rem; font-weight:600;
    text-transform:uppercase; letter-spacing:.12em; color:#94a3b8;
  }
  .sql-sub { font-family:'IBM Plex Mono',monospace; font-size:.58rem; color:#cbd5e1; flex:1; }
  .copy-btn {
    padding:.15rem .55rem;
    background:#fff; border:1px solid #e2e8f0;
    border-radius:4px; color:#64748b;
    font-size:.6rem; font-family:'IBM Plex Mono',monospace; cursor:pointer;
  }
  .copy-btn:hover { color:#0854a8; border-color:#0854a8; }
  .sql-box {
    flex:1; resize:none; background:transparent; border:none; outline:none;
    color:#0854a8; font-family:'IBM Plex Mono',monospace;
    font-size:.72rem; line-height:1.7; padding:.55rem .85rem; cursor:default;
  }

  /* ── Download popup ─────────────────────────────────────────────────── */
  .popup-backdrop {
    position: absolute; inset: 0; z-index: 100;
    background: rgba(15,23,42,.35);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
  }
  .popup {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1.75rem 2rem;
    max-width: 420px; width: 90%;
    display: flex; flex-direction: column; gap: 1rem;
    box-shadow: 0 24px 64px rgba(0,0,0,.15);
  }
  .popup-icon { font-size: 1.6rem; color: #0854a8; }
  .popup h3 {
    font-size: 1rem; font-weight: 600; color: #0f172a;
    font-family: 'IBM Plex Sans', sans-serif; margin: 0;
  }
  .popup p {
    font-size: .82rem; color: #475569; line-height: 1.7; margin: 0;
    font-family: 'IBM Plex Sans', sans-serif;
  }
  .popup a { color: #0854a8; text-decoration: none; }
  .popup a:hover { text-decoration: underline; }
  .popup-close {
    align-self: flex-end;
    padding: .42rem 1.1rem;
    background: #0854a8; border: none;
    border-radius: 6px; color: #fff;
    font-family: inherit; font-size: .78rem; font-weight: 600;
    cursor: pointer; transition: background .15s;
  }
  .popup-close:hover { background: #0a6fd4; }
</style>
