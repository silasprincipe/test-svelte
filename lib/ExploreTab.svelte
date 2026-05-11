<script lang="ts">
  /**
   * ExploreTab.svelte — Full-width result panel for the Explore tab.
   * 
   * Receives the active query result from the parent (+page.svelte).
   * Shows: headline stat · full scrollable table · CSV download.
   */

  export interface ExploreRow { [col: string]: unknown; }

  let {
    title       = '',
    statNumber  = '',
    statLabel   = '',
    cols        = [] as string[],
    rows        = [] as ExploreRow[],
    loading     = false,
    error       = '',
    onDownload  = () => {},
  }: {
    title:      string;
    statNumber: string;
    statLabel:  string;
    cols:       string[];
    rows:       ExploreRow[];
    loading:    boolean;
    error:      string;
    onDownload: () => void;
  } = $props();

  // ── Column display labels ─────────────────────────────────────────────────
  const COL_LABELS: Record<string, string> = {
    species: 'Species', AphiaID: 'OBIS', total_records: 'Records',
    total_cells: 'Cells', last_seen: 'Last seen', record_count: 'Records',
    min_year: 'First obs.', max_year: 'Last obs.', cell: 'H3 cell',
    cell_r4: 'H3 cell (res-4)', total_species: 'Species',
  };
  function colLabel(c: string) { return COL_LABELS[c] ?? c; }

  // ── Never abbreviate these columns ───────────────────────────────────────
  const NO_ABBREV = new Set(['AphiaID', 'last_seen', 'min_year', 'max_year']);

  function fmtVal(col: string, v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (NO_ABBREV.has(col)) return String(v);
    const n = Number(v);
    if (!isNaN(n) && Math.abs(n) >= 10_000) {
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      return (n / 1e3).toFixed(1) + 'k';
    }
    return String(v);
  }
</script>

<div class="panel">

  {#if !title}
    <!-- Nothing selected yet -->
    <div class="empty">
      <div class="empty-icon">◈</div>
      <p>Select a query from the sidebar and click <strong>Run</strong> to explore the data.</p>
    </div>

  {:else if loading}
    <div class="empty">
      <div class="spinner"></div>
      <p>Running query against S3…</p>
    </div>

  {:else if error}
    <div class="empty error-state">
      <p class="err">{error}</p>
    </div>

  {:else}
    <!-- Header bar: stat + download -->
    <div class="result-header">
      <div class="stat">
        <span class="stat-num">{statNumber}</span>
        <span class="stat-lbl">{statLabel}</span>
      </div>
      {#if rows.length > 0}
        <button class="csv-btn" onclick={onDownload}>
          ↓ Download CSV
        </button>
      {/if}
    </div>

    <!-- Full-height table -->
    {#if rows.length > 0}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each cols as c}
                <th>{colLabel(c)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as row}
              <tr>
                {#each cols as c}
                  {#if c === 'AphiaID' && row[c] != null}
                    <td>
                      <a
                        href="https://obis.org/taxon/{row[c]}"
                        target="_blank"
                        rel="noopener"
                        class="obis-link"
                        title="View on OBIS"
                      >{row[c]}</a>
                    </td>
                  {:else if c === 'species' && row['AphiaID'] != null}
                    <td>
                      <a
                        href="https://obis.org/taxon/{row['AphiaID']}"
                        target="_blank"
                        rel="noopener"
                        class="species-link"
                        title="View on OBIS"
                      ><em>{String(row[c])}</em></a>
                    </td>
                  {:else}
                    <td>{fmtVal(c, row[c])}</td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if !loading}
      <div class="empty"><p>No results returned.</p></div>
    {/if}
  {/if}

</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #fff;
    overflow: hidden;
  }

  /* ── Empty / loading state ───────────────────────────────────────────── */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .75rem;
    color: #94a3b8;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: .85rem;
    text-align: center;
    padding: 2rem;
  }
  .empty p { max-width: 320px; line-height: 1.6; }
  .empty strong { color: #475569; }
  .empty-icon { font-size: 2rem; color: #cbd5e1; }

  .spinner {
    width: 28px; height: 28px;
    border: 2px solid #e2e8f0; border-top-color: #0854a8;
    border-radius: 50%; animation: spin .75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .err { color: #dc2626; font-family: 'IBM Plex Mono', monospace; font-size: .78rem; }

  /* ── Result header ───────────────────────────────────────────────────── */
  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .75rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
    background: #f8fafc;
  }

  .stat { display: flex; align-items: baseline; gap: .55rem; }

  .stat-num {
    font-size: 1.6rem;
    font-weight: 700;
    color: #0854a8;
    font-family: 'IBM Plex Mono', monospace;
    line-height: 1;
  }

  .stat-lbl {
    font-size: .72rem;
    color: #94a3b8;
    font-family: 'IBM Plex Sans', sans-serif;
  }

  .csv-btn {
    padding: .35rem .9rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    color: #0854a8;
    font-size: .72rem;
    font-weight: 600;
    font-family: 'IBM Plex Mono', monospace;
    cursor: pointer;
    transition: all .15s;
  }
  .csv-btn:hover { background: #0854a8; color: #fff; border-color: #0854a8; }

  /* ── Table ───────────────────────────────────────────────────────────── */
  .table-wrap {
    flex: 1;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(0,0,0,.1) transparent;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: .75rem;
    font-family: 'IBM Plex Mono', monospace;
  }

  th {
    position: sticky;
    top: 0;
    background: #f8fafc;
    color: #64748b;
    font-size: .6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .07em;
    padding: .5rem .9rem;
    text-align: left;
    border-bottom: 2px solid #e2e8f0;
    white-space: nowrap;
    z-index: 1;
  }

  td {
    padding: .38rem .9rem;
    color: #334155;
    border-bottom: 1px solid #f1f5f9;
    white-space: nowrap;
  }

  tr:hover td { background: #f8fafc; }

  /* Species name link */
  .species-link {
    color: #0f172a;
    text-decoration: none;
  }
  .species-link:hover { color: #0854a8; text-decoration: underline; }

  /* AphiaID link — small pill style */
  .obis-link {
    display: inline-block;
    padding: .1rem .4rem;
    background: rgba(8,84,168,.06);
    border: 1px solid rgba(8,84,168,.2);
    border-radius: 4px;
    color: #0854a8;
    font-size: .65rem;
    text-decoration: none;
    transition: all .15s;
  }
  .obis-link:hover {
    background: #0854a8;
    color: #fff;
  }
</style>
