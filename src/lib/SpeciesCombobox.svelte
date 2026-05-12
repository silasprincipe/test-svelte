<script lang="ts">
  /**
   * SpeciesCombobox.svelte
   *
   * Fast autocomplete against the pre-fetched full species list.
   * Filtering is done purely client-side (no DuckDB round-trip per keystroke)
   * because we fetch all ~130k species names once on boot and cache them.
   *
   * The list is stored in db.speciesList (db.svelte.ts).
   * This component just filters it locally with String.includes().
   */
  import { db } from '$lib/db.svelte';
 
  let { value = $bindable(''), onSelect }: {
    value: string;
    onSelect?: (species: string | null) => void;
  } = $props();
 
  let inputText    = $state(value);
  let filterText   = $state('');   // debounced — only updated after user pauses typing
  let showDropdown = $state(false);
  let activeIdx    = $state(-1);
  let debounceTimer: ReturnType<typeof setTimeout>;
 
  // matches derives from filterText (debounced), not inputText (live keystroke).
  // This prevents the 256k-entry filter from running on every character typed.
  const matches = $derived.by(() => {
    const term = filterText.trim().toLowerCase();
    if (!term || term.length < 2) return [];
    return db.speciesList
      .filter(s => s.toLowerCase().includes(term))
      .slice(0, 30);
  });
 
  function select(species: string) {
    inputText    = species;
    value        = species;
    showDropdown = false;
    activeIdx    = -1;
    onSelect?.(species);
  }
 
  function clear() {
    inputText    = '';
    value        = '';
    showDropdown = false;
    onSelect?.(null);
  }
 
  function onInput() {
    showDropdown = true;
    activeIdx    = -1;
    if (!inputText.trim()) {
      filterText = '';
      onSelect?.(null);
      return;
    }
    // Debounce: only run the expensive filter after 200ms pause in typing
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { filterText = inputText; }, 200);
  }
 
  function onKeydown(e: KeyboardEvent) {
    const m = matches;
    if (!showDropdown || !m.length) {
      if (e.key === 'Enter' && inputText.trim()) select(inputText.trim());
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx+1, m.length-1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx-1, 0); }
    if (e.key === 'Enter')     { e.preventDefault(); if (activeIdx >= 0) select(m[activeIdx]); }
    if (e.key === 'Escape')    { showDropdown = false; }
  }
</script>
 
<div class="combo">
  <div class="input-wrap" class:open={showDropdown && matches.length > 0}>
    <input
      bind:value={inputText}
      oninput={onInput}
      onkeydown={onKeydown}
      onfocus={() => { if (matches.length) showDropdown = true; }}
      onblur={() => setTimeout(() => { showDropdown = false; }, 160)}
      placeholder={db.speciesLoaded ? 'Search species…' : 'Loading species list…'}
      disabled={!db.speciesLoaded}
      spellcheck="false"
      autocomplete="off"
    />
    {#if inputText}
      <button class="clear" onclick={clear} tabindex="-1">✕</button>
    {:else if !db.speciesLoaded}
      <span class="loading-dot">…</span>
    {/if}
  </div>
 
  {#if showDropdown && matches.length > 0}
    <ul class="dropdown" role="listbox">
      {#each matches as s, i}
        <li
          class="option"
          class:active={i === activeIdx}
          role="option"
          aria-selected={i === activeIdx}
          onmousedown={() => select(s)}
        >
          <em>{s}</em>
        </li>
      {/each}
      {#if matches.length === 30}
        <li class="more">…type more to narrow results</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .combo { position: relative; }

  .input-wrap {
    display: flex;
    align-items: center;
    background: rgba(255,255,255,0.05);
    border-radius: 5px;
    border: 1px solid #e2e8f0;
    padding: 0 0.5rem 0 0.7rem;
    transition: border-color 0.15s;
  }
  .input-wrap.open { border-color: rgba(56,189,248,0.4); border-radius: 7px 7px 0 0; }
  .input-wrap:focus-within { border-color: rgba(56,189,248,0.4); }

  input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #2c3949;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.78rem;
    font-style: italic;
    padding: 0.48rem 0;
  }
  input::placeholder { color: #94a3b8; font-style: normal; }
  input:disabled     { opacity: 0.4; cursor: wait; }

  .clear {
    background: none; border: none;
    color: #475569; font-size: 0.65rem;
    cursor: pointer; padding: 0; line-height: 1; flex-shrink: 0;
  }
  .clear:hover { color: #94a3b8; }
  .loading-dot { font-size: 0.75rem; color: #38bdf8; animation: blink 1s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }

  .dropdown {
    position: absolute;
    top: 100%; left: 0; right: 0;
    background: #94a3b8;
    border: 1px solid rgba(56,189,248,0.2);
    border-top: none;
    border-radius: 0 0 7px 7px;
    list-style: none;
    max-height: 260px;
    overflow-y: auto;
    z-index: 200;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.08) transparent;
  }

  .option {
    padding: 0.38rem 0.75rem;
    font-size: 0.76rem;
    color: #35445a;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .option em { font-style: italic; }
  .option:hover, .option.active { background: rgba(56,189,248,0.08); color: #e2e8f0; }
  .option:last-child { border-bottom: none; }

  .more {
    padding: 0.32rem 0.75rem;
    font-size: 0.62rem;
    color: #334155;
    font-style: italic;
  }
</style>
