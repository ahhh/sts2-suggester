/**
 * Bootstrap and event routing.
 *
 * One delegated listener handles every `data-act` in the app. Load order:
 * game data first (so starter seeding and search work), then metrics for the
 * bracket the run implies.
 */

import * as S from './state.js';
import * as Score from './scoring.js';
import { loadGameData, loadMetrics, defaultBracket, game, dataStatus } from './data.js';
import { clearAllLocalData } from './storage.js';
import * as UI from './ui.js';
import * as Bias from './bias.js';
import { initTooltips, setMetricsSource, hide as hideTooltip } from './tooltip.js';

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    await loadGameData();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<div style="padding:60px 24px;max-width:52ch;margin:0 auto;font-family:system-ui">
      <h1>Could not load card data</h1>
      <p>The Spire Codex API and the bundled snapshot both failed. Check your connection and reload.</p>
      <pre style="color:#e05068;white-space:pre-wrap">${String(err)}</pre></div>`;
    return;
  }

  Bias.loadBiases();
  const resumed = S.restore();
  S.subscribe(onStateChange);

  setMetricsSource(() => UI.view.cardMetrics);
  initTooltips();

  await syncMetrics();
  UI.renderAll();

  if (resumed && S.primary()?.character) {
    UI.toast(`Resumed your ${game.characters.get(S.primary().character)?.name.replace(/^The /, '') ?? ''} run — floor ${S.state.game.floor}.`);
  }
}

/** Reloads the metrics table when the run implies a different bracket. */
async function syncMetrics() {
  const bracket = S.state.preferences.bracket || defaultBracket(S.state);
  if (UI.view.bracket === bracket && UI.view.cardMetrics) return;
  UI.view.loadingMetrics = true;
  try {
    const [cards, relics] = await Promise.all([
      loadMetrics('cards', bracket),
      loadMetrics('relics', bracket),
    ]);
    UI.view.cardMetrics = cards;
    UI.view.relicMetrics = relics;
    UI.view.bracket = bracket;
  } catch (err) {
    console.warn('metrics unavailable', err);
    dataStatus.note = 'Statistics unavailable — recommendations fall back to card mechanics only.';
  } finally {
    UI.view.loadingMetrics = false;
  }
}

let rerenderQueued = false;
function onStateChange() {
  // Any state change invalidates a ranking computed from the old state.
  if (rerenderQueued) return;
  rerenderQueued = true;
  queueMicrotask(async () => {
    rerenderQueued = false;
    await syncMetrics();
    UI.renderAll();
    if (UI.picker.open) UI.renderPicker();
  });
}

/** Recomputes the ranking against current state. */
function rank() {
  if (!UI.view.cardMetrics) { UI.toast('Statistics are still loading.'); return; }
  UI.view.ranked = Score.rankRewards(UI.ctx());
  UI.renderAll();
}

/* ------------------------------------------------------------- run actions */

function startRun() {
  const d = setupDraftRef();
  if (!d.character) return;
  const fresh = S.newRunState();
  fresh.game.mode = d.mode;
  fresh.game.ascension = d.ascension;
  S.setState(fresh);
  if (d.mode === 'multiplayer') S.setPartySize(d.partySize);
  S.seedPlayer(S.primary(), d.character, d.ascension);
  S.emit();
  UI.toast('Starter deck, relic and HP filled in. Add whatever has changed since floor 1.');
}

/** The setup screen keeps its draft inside ui.js; this reads it back. */
function setupDraftRef() {
  return window.__setupDraft;
}

function exportRun() {
  const blob = new Blob([S.exportRun()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const ch = S.primary()?.character?.toLowerCase() ?? 'run';
  a.download = `sts2-${ch}-a${S.state.game.ascension}-floor${S.state.game.floor}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  UI.toast('Run exported.');
}

function importRun() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      S.importRun(await file.text());
      UI.view.ranked = null;
      UI.toast('Run loaded.');
    } catch (err) {
      UI.toast(`That file could not be read: ${err.message}`);
    }
  };
  input.click();
}

/* ------------------------------------------------------- personal weighting */

/**
 * Weightings live outside run state, so they do not go through `S.emit()`.
 * A visible ranking was computed under the old weights, so recompute it rather
 * than leaving a stale order on screen.
 */
function refreshAfterBias() {
  hideTooltip();
  if (UI.view.ranked && UI.view.cardMetrics) UI.view.ranked = Score.rankRewards(UI.ctx());
  UI.renderAll();
}

function announce(cardId, before, after) {
  const name = game.cards.get(cardId)?.name ?? 'That card';
  if (after === before) {
    UI.toast(`${name} is already ${before > 0 ? 'as high' : 'as low'} as your weighting goes (${Bias.MAX_BIAS} tiers).`);
    return;
  }
  if (!after) { UI.toast(`${name} is back on the community ranking.`); return; }
  const tier = UI.view.cardMetrics?.get(cardId, false)?.row?.tier || null;
  UI.toast(`${name} ${after > 0 ? 'ranked up' : 'ranked down'} — ${Bias.tierShiftLabel(after, tier)}.`);
}

function nudgeBias(cardId, dir) {
  const before = Bias.biasOf(cardId);
  const after = Bias.nudgeBias(cardId, dir);
  refreshAfterBias();
  announce(cardId, before, after);
}

function setBias(cardId, steps) {
  const before = Bias.biasOf(cardId);
  const after = Bias.setBias(cardId, steps);
  refreshAfterBias();
  announce(cardId, before, after);
}

/* --------------------------------------------------------- event dispatch */

const ACTIONS = {
  /* --- setup ------------------------------------------------------------ */
  'setup-mode': (el) => { window.__setupDraft.mode = el.dataset.mode; UI.renderAll(); },
  'setup-party': (el) => { window.__setupDraft.partySize = Number(el.dataset.n); UI.renderAll(); },
  'setup-char': (el) => { window.__setupDraft.character = el.dataset.id; UI.renderAll(); },
  'setup-asc': (el) => { window.__setupDraft.ascension = Number(el.value); UI.renderAll(); },
  'setup-start': startRun,

  /* --- run context ------------------------------------------------------ */
  'set-mode': (el) => { S.setMode(el.dataset.mode); UI.view.ranked = null; },
  'set-asc': (el) => {
    const asc = Number(el.value);
    const p = S.primary();
    const wasUntouched = S.isUntouched(p);
    S.patchGame({ ascension: asc });
    // Ascender's Bane appears at A5+; only reseed if nothing has been edited.
    if (wasUntouched && p.character) { S.seedPlayer(p, p.character, asc); S.emit(); }
  },
  'set-act': (el) => S.patchGame({ act: Number(el.value) }),
  'set-floor': (el) => S.patchGame({ floor: Math.max(0, Number(el.value) || 0) }),
  'set-hp': (el) => S.patchPlayer(S.state.primaryPlayerId, { hp: el.value === '' ? null : Number(el.value) }),
  'set-maxhp': (el) => S.patchPlayer(S.state.primaryPlayerId, { maxHp: el.value === '' ? null : Number(el.value) }),
  'set-gold': (el) => S.patchPlayer(S.state.primaryPlayerId, { gold: el.value === '' ? null : Number(el.value) }),
  'set-bracket': (el) => { S.state.preferences.bracket = el.value || null; UI.view.ranked = null; S.emit(); },
  'next-floor': () => S.nextFloor(),

  'set-party': (el) => S.setPartySize(Number(el.dataset.n)),
  'set-primary': (el) => { S.setPrimary(el.dataset.id); UI.view.ranked = null; },
  'set-mate-char': (el) => {
    const p = S.playerById(el.dataset.id);
    if (!p) return;
    if (el.value) S.seedPlayer(p, el.value); else p.character = null;
    S.emit();
  },
  'toggle-role': (el) => {
    const p = S.playerById(el.dataset.id);
    if (!p) return;
    const r = el.dataset.role;
    p.roleTags = p.roleTags?.includes(r) ? p.roleTags.filter((x) => x !== r) : [...(p.roleTags || []), r];
    S.emit();
  },

  'reset-starter': () => {
    const p = S.primary();
    if (!p.character) return;
    if (!S.isUntouched(p) && !confirm('Replace your current deck and relics with the character starter state?')) return;
    S.resetToStarter(p.id);
    UI.view.ranked = null;
    UI.toast('Back to the character starter state.');
  },
  'start-empty': () => {
    if (!confirm('Clear the deck and relics? Run context and HP are kept.')) return;
    S.startEmpty(S.state.primaryPlayerId);
    UI.view.ranked = null;
  },
  'new-run': () => {
    if (!confirm('Discard this run and start over?')) return;
    S.discardRun();
    UI.view.ranked = null;
    window.__setupDraft = { character: null, mode: 'singleplayer', ascension: 0, partySize: 2 };
  },
  'export-run': exportRun,
  'import-run': importRun,
  'clear-data': async () => {
    if (!confirm('Delete the saved run, preferences and cached statistics from this browser?')) return;
    await clearAllLocalData();
    location.reload();
  },

  /* --- deck ------------------------------------------------------------- */
  'add-card': () => UI.openPicker({ kind: 'card', purpose: 'deck', title: 'Add a card to your deck' }),
  'add-relic': () => UI.openPicker({ kind: 'relic', purpose: 'deck', title: 'Add a relic' }),
  'card-add': (el) => S.addCard(S.state.primaryPlayerId, el.dataset.id),
  'card-remove': (el) => S.removeCard(S.state.primaryPlayerId, el.dataset.id),
  'card-upgrade': (el) => S.upgradeCard(S.state.primaryPlayerId, el.dataset.id),
  'card-downgrade': (el) => S.downgradeCard(S.state.primaryPlayerId, el.dataset.id),
  'relic-remove': (el) => S.removeRelic(S.state.primaryPlayerId, el.dataset.id),
  'remove-one': (el) => {
    const entry = S.primary().deck.find((d) => d.cardId === el.dataset.id);
    if (!entry) return;
    S.removeCard(S.state.primaryPlayerId, el.dataset.id, { upgraded: entry.normal === 0 });
    UI.toast(`Removed ${game.cards.get(el.dataset.id)?.name}.`);
  },

  /* --- reward flow ------------------------------------------------------ */
  'add-candidate': () => UI.openPicker({ kind: 'card', purpose: 'reward', title: 'What were you offered?' }),
  'remove-candidate': (el) => { S.removeCandidate(Number(el.dataset.i)); UI.view.ranked = null; },
  'clear-cands': () => { S.clearCandidates(); UI.view.ranked = null; },
  'toggle-cand-upgrade': (el) => {
    const c = S.state.currentChoice.candidates[Number(el.dataset.i)];
    if (!c) return;
    c.upgraded = !c.upgraded;
    UI.view.ranked = null;
    S.emit();
  },
  'toggle-skip': (el) => { S.state.currentChoice.allowSkip = el.checked; UI.view.ranked = null; S.emit(); },
  'cand-bias-up': (el) => nudgeBias(el.dataset.id, +1),
  'cand-bias-down': (el) => nudgeBias(el.dataset.id, -1),
  'cand-bias-clear': (el) => setBias(el.dataset.id, 0),
  'clear-bias': () => {
    if (!confirm('Forget every card weighting you have set? Runs and decks are untouched.')) return;
    Bias.clearBiases();
    refreshAfterBias();
    UI.toast('Card weightings cleared.');
  },
  rank,
  took: (el) => {
    const card = game.cards.get(el.dataset.id);
    S.clearCandidates();
    S.addCard(S.state.primaryPlayerId, el.dataset.id, { upgraded: el.dataset.up === 'true' });
    UI.view.ranked = null;
    UI.toast(`${card?.name} added. Deck is now ${S.deckSize(S.primary())} cards.`);
  },
  'cand-to-deck': (el) => {
    S.addCard(S.state.primaryPlayerId, el.dataset.id, { upgraded: el.dataset.up === 'true' });
    UI.toast(`${game.cards.get(el.dataset.id)?.name} added to your deck.`);
  },
  'took-skip': () => {
    S.clearCandidates();
    UI.view.ranked = null;
    S.emit();
    UI.toast('Skipped. Nothing added.');
  },

  /* --- picker ----------------------------------------------------------- */
  'picker-close': () => UI.closePicker(),
  'picker-pick': (el) => {
    const id = el.dataset.id;
    if (UI.picker.kind === 'relic') {
      S.addRelic(S.state.primaryPlayerId, id);
      UI.toast(`${game.relics.get(id)?.name} added.`);
      return;
    }
    if (UI.picker.purpose === 'reward') {
      S.addCandidate(id);
      UI.view.ranked = null;
      if (S.state.currentChoice.candidates.length >= 3) UI.closePicker();
      return;
    }
    S.addCard(S.state.primaryPlayerId, id);
    UI.toast(`${game.cards.get(id)?.name} added — click again for another copy.`);
  },
  'pf-type': (el) => {
    UI.picker.filters.type = UI.picker.filters.type === el.dataset.v ? undefined : el.dataset.v;
    UI.renderPicker();
  },
  'pf-rarity': (el) => {
    UI.picker.filters.rarity = UI.picker.filters.rarity === el.dataset.v ? undefined : el.dataset.v;
    UI.renderPicker();
  },
  'pf-colors': () => {
    UI.picker.allColors = !UI.picker.allColors;
    UI.renderPicker();
    UI.toast(UI.picker.allColors
      ? 'Showing every character’s cards — for Kaleidoscope and friends.'
      : 'Back to cards your character can actually be offered.');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  fn(el);
});

document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || (el.tagName !== 'SELECT' && el.tagName !== 'INPUT')) return;
  ACTIONS[el.dataset.act]?.(el);
});

// Number fields should feel live without committing a partial value on every key.
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'picker-search') {
    UI.picker.query = el.value;
    UI.renderPicker();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && UI.picker.open) { UI.closePicker(); return; }
  // Enter in the album takes the single remaining match.
  if (ev.key === 'Enter' && UI.picker.open && ev.target.id === 'picker-search') {
    const first = document.querySelector('#picker-grid .albumcard');
    if (first) { ev.preventDefault(); first.click(); }
    return;
  }
  if (ev.target.matches('input, select, textarea')) return;
  if (ev.key === 'a' && !UI.picker.open && S.primary()?.character) {
    ACTIONS['add-candidate']();
  }
  if (ev.key === 'd' && !UI.picker.open && S.primary()?.character) {
    ACTIONS['add-card']();
  }
});

document.getElementById('picker').addEventListener('click', (ev) => {
  if (ev.target.id === 'picker') UI.closePicker();
});

window.__setupDraft = { character: null, mode: 'singleplayer', ascension: 0, partySize: 2 };

boot();
