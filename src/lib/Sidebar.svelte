<script lang="ts">
  /**
   * Sidebar.svelte — All query controls
   * Emits a single `onChange` event whenever any control changes,
   * carrying the full current QueryControls object.
   */
  import SpeciesCombobox from '$lib/SpeciesCombobox.svelte';
  import { db } from '$lib/db.svelte';
  import type { QueryControls } from '$lib/buildQuery';

  let {
    controls = $bindable<QueryControls>({
      species:      null,
      dateMin:      null,
      dateMax:      null,
      h3Resolution: 4,
      metric:       'species',
    }),
    rowCount = 0,
    loading  = false,
    onRun,
    onDownload,
  }: {
    controls:   QueryControls;
    rowCount:   number;
    loading:    boolean;
    onRun:      () => void;
    onDownload: () => void;
  } = $props();

  let speciesValue = $state(controls.species ?? '');

  function fmt(n: number) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
    return n.toLocaleString();
  }

  const H3_RESOLUTIONS = [
    { value: 3, label: 'Res 3  (~700km)' },
    { value: 4, label: 'Res 4  (~300km)' },
    { value: 5, label: 'Res 5  (~110km)' },
    { value: 6, label: 'Res 6  (~40km)'  },
    { value: 7, label: 'Res 7  (~15km — native)' },
  ] as const;
</script>

<aside class="sidebar">

  <!-- Header -->
  <div class="brand">
    <a href="/" class="logo">◈ OBIS Explorer</a>
    <a href="/docs" class="docs-link">Docs ↗</a>
  </div>

  <!-- Status -->
  <div class="status" data-s={db.status}>
    <span class="dot"></span>
    {#if db.status === 'booting'}  Connecting to DuckDB…
    {:else if db.status === 'ready' && !db.speciesLoaded} Ready · loading species list…
    {:else if db.status === 'ready'} {fmt(db.speciesList.length)} species indexed
    {:else if db.status === 'error'} Error: {db.error}
    {:else} Idle
    {/if}
  </div>

  <!-- ── Species ──────────────────────────────────────────────────── -->
  <section>
    <label class="section-label">Species <span class="optional">(optional — all if blank)</span></label>
    <SpeciesCombobox
      bind:value={speciesValue}
      onSelect={(s) => { controls.species = s; }}
    />
  </section>

  <!-- ── Date range ──────────────────────────────────────────────── -->
  <section>
    <label class="section-label">Date range</label>
    <div class="date-row">
      <div class="date-field">
        <span>From</span>
        <input type="date" bind:value={controls.dateMin} />
      </div>
      <div class="date-field">
        <span>To</span>
        <input type="date" bind:value={controls.dateMax} />
      </div>
    </div>
    {#if controls.dateMin || controls.dateMax}
      <button class="clear-dates" onclick={() => { controls.dateMin = null; controls.dateMax = null; }}>
        Clear dates
      </button>
    {/if}
  </section>

  <!-- ── H3 resolution ───────────────────────────────────────────── -->
  <section>
    <label class="section-label">H3 aggregation level</label>
    <div class="resolution-grid">
      {#each H3_RESOLUTIONS as r}
        <button
          class="res-btn"
          class:active={controls.h3Resolution === r.value}
          onclick={() => (controls.h3Resolution = r.value)}
        >
          <span class="res-num">{r.value}</span>
          <span class="res-km">{r.label.split('(')[1].replace(')', '')}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ── Metric ───────────────────────────────────────────────────── -->
  <section>
    <label class="section-label">Metric</label>
    <div class="seg">
      <button
        class:active={controls.metric === 'species'}
        onclick={() => (controls.metric = 'species')}
      >
        # species
      </button>
      <button
        class:active={controls.metric === 'records'}
        onclick={() => (controls.metric = 'records')}
      >
        # records
      </button>
    </div>
  </section>

  <!-- ── Run / results ───────────────────────────────────────────── -->
  <section class="run-section">
    <button class="run-btn" onclick={onRun} disabled={db.status !== 'ready' || loading}>
      {#if loading}
        <span class="spin">⟳</span> Querying…
      {:else}
        ▶ Run Query
      {/if}
    </button>

    {#if rowCount > 0}
      <div class="result-badge">
        {fmt(rowCount)} cells returned
      </div>
    {/if}
  </section>

  <!-- ── Download ─────────────────────────────────────────────────── -->
  {#if rowCount > 0}
    <section>
      <button class="dl-btn" onclick={onDownload} disabled={loading}>
        ↓ Download as Parquet
      </button>
      <p class="dl-note">
        Results are exported as a Parquet file using DuckDB's COPY statement,
        compatible with Python (pandas, geopandas), R, and QGIS.
      </p>
    </section>
  {/if}

  <footer>
    <a href="/docs">Documentation</a> ·
    <a href="https://obis.org" target="_blank" rel="noopener">obis.org</a> ·
    <a href="https://github.com/iobis/speciesgrids" target="_blank" rel="noopener">GitHub</a>
  </footer>

</aside>

<style>
  .sidebar {
    width: 280px;
    min-width: 280px;
    height: 100vh;
    background: rgba(6,9,20,0.97);
    border-right: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 0 0 1rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.07) transparent;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
  }

  /* Brand */
  .brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1rem 0.7rem;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .logo {
    font-size: 0.9rem;
    font-weight: 600;
    color: #38bdf8;
    text-decoration: none;
    letter-spacing: 0.02em;
  }
  .docs-link {
    font-size: 0.65rem;
    color: #475569;
    text-decoration: none;
    transition: color 0.15s;
  }
  .docs-link:hover { color: #38bdf8; }

  /* Status */
  .status {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 1rem;
    font-size: 0.65rem;
    color: #334155;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .status[data-s="ready"]   { color: #34d399; }
  .status[data-s="booting"] { color: #38bdf8; }
  .status[data-s="error"]   { color: #f87171; }
  .dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: currentColor; flex-shrink: 0;
  }
  .status[data-s="ready"] .dot { animation: blink 2.5s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }

  /* Sections */
  section {
    padding: 0.8rem 1rem;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .section-label {
    font-size: 0.58rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #334155;
  }
  .optional { font-weight: 400; text-transform: none; letter-spacing: 0; color: #1e293b; }

  /* Date range */
  .date-row { display: flex; gap: 0.5rem; }
  .date-field {
    flex: 1; display: flex; flex-direction: column; gap: 0.2rem;
    font-size: 0.6rem; color: #475569;
  }
  .date-field input[type="date"] {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 5px;
    color: #cbd5e1;
    font-family: inherit;
    font-size: 0.7rem;
    padding: 0.32rem 0.4rem;
    outline: none;
    width: 100%;
  }
  .date-field input:focus { border-color: rgba(56,189,248,0.35); }

  .clear-dates {
    align-self: flex-start;
    background: none; border: none;
    color: #334155; font-size: 0.62rem;
    cursor: pointer; font-family: inherit;
    text-decoration: underline;
    padding: 0;
  }
  .clear-dates:hover { color: #64748b; }

  /* H3 resolution grid */
  .resolution-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.3rem;
  }
  .res-btn {
    display: flex; flex-direction: column; align-items: center;
    padding: 0.4rem 0.2rem;
    border-radius: 5px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03);
    cursor: pointer;
    transition: all 0.15s;
    gap: 0.15rem;
  }
  .res-btn.active {
    border-color: rgba(56,189,248,0.4);
    background: rgba(56,189,248,0.1);
  }
  .res-num {
    font-size: 0.82rem; font-weight: 600;
    color: #64748b;
  }
  .res-btn.active .res-num { color: #38bdf8; }
  .res-km { font-size: 0.52rem; color: #334155; text-align: center; line-height: 1.2; }
  .res-btn.active .res-km { color: #0ea5e9; }

  /* Metric segmented control */
  .seg {
    display: flex;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.07);
    overflow: hidden;
  }
  .seg button {
    flex: 1; padding: 0.42rem 0.5rem;
    background: none; border: none;
    color: #475569; font-size: 0.7rem;
    cursor: pointer; font-family: inherit;
    transition: all 0.15s;
  }
  .seg button.active { background: rgba(56,189,248,0.12); color: #38bdf8; }
  .seg button + button { border-left: 1px solid rgba(255,255,255,0.07); }

  /* Run */
  .run-section { gap: 0.6rem; }
  .run-btn {
    width: 100%;
    padding: 0.55rem;
    background: rgba(56,189,248,0.1);
    border: 1px solid rgba(56,189,248,0.3);
    border-radius: 7px;
    color: #38bdf8;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 0.4rem;
  }
  .run-btn:hover:not(:disabled) { background: rgba(56,189,248,0.2); }
  .run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .spin { display: inline-block; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .result-badge {
    text-align: center;
    font-size: 0.68rem;
    color: #34d399;
    padding: 0.25rem 0;
  }

  /* Download */
  .dl-btn {
    width: 100%;
    padding: 0.45rem;
    background: rgba(52,211,153,0.07);
    border: 1px solid rgba(52,211,153,0.25);
    border-radius: 6px;
    color: #34d399;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }
  .dl-btn:hover:not(:disabled) { background: rgba(52,211,153,0.14); }
  .dl-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .dl-note {
    font-size: 0.6rem;
    color: #1e293b;
    line-height: 1.55;
  }

  /* Footer */
  footer {
    margin-top: auto;
    padding: 1rem 1rem 0;
    font-size: 0.6rem;
    color: #1e293b;
    line-height: 2;
  }
  footer a { color: #334155; text-decoration: none; }
  footer a:hover { color: #38bdf8; }
</style>
