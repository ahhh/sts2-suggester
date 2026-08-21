/**
 * Live run state and the mutations the UI performs on it.
 *
 * Multiplayer is modelled from the start (plan §26): even a solo run is a party
 * of one, so adding players later is an extension rather than a rewrite.
 *
 * Starter states come from the API's character records rather than a hard-coded
 * table, so they stay correct across Early Access patches (plan §43, amended).
 */

import { game } from './data.js';
import { saveRun, loadRun, clearRun } from './storage.js';

export const SCHEMA_VERSION = 2;

/** STS2 tops out at Ascension 10. */
export const MAX_ASCENSION = 10;

/** A5 "Ascender's Bane" — the only ascension level that alters the starting deck. */
export const ASCENDERS_BANE_LEVEL = 5;
const ASCENDERS_BANE_ID = 'ASCENDERS_BANE';

export const PARTY_ROLES = ['Damage', 'Block', 'Debuff', 'Support', 'Scaling'];

let listeners = [];
export function subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; }
export function emit() { for (const fn of listeners) fn(state); persist(); }

/* --------------------------------------------------------------- run state */

export function newRunState(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    startedAt: Date.now(),
    game: {
      mode: 'singleplayer', // singleplayer | multiplayer | daily
      ascension: 0,
      act: 1,
      floor: 1,
    },
    primaryPlayerId: 'p1',
    players: [newPlayer('p1', 'You')],
    currentChoice: { type: 'card_reward', candidates: [], allowSkip: true },
    preferences: {
      bracket: null,     // null = follow the run (see defaultBracket)
      startEmpty: false,
      showUpgradedCandidates: false,
    },
    ...overrides,
  };
}

export function newPlayer(id, label) {
  return {
    id,
    label,
    character: null,
    entryMode: 'full', // 'full' | 'quick' — teammates may be described loosely
    hp: null,
    maxHp: null,
    gold: null,
    deck: [],   // [{cardId, normal, upgraded}]
    relics: [], // [relicId]
    potions: [],
    roleTags: [],
    touched: false, // has the user edited away from the seeded starter state?
  };
}

export let state = newRunState();

export function setState(next) { state = next; emit(); }

/* ------------------------------------------------------------ player access */

export function primary() {
  return state.players.find((p) => p.id === state.primaryPlayerId) || state.players[0];
}

export function playerById(id) { return state.players.find((p) => p.id === id); }

export function teammates() { return state.players.filter((p) => p.id !== state.primaryPlayerId); }

/* ------------------------------------------------------- starter seeding */

/** `StrikeDefect` / `RingOfTheSnake` -> `STRIKE_DEFECT` / `RING_OF_THE_SNAKE`. */
export function normalizeId(raw) {
  return String(raw).replace(/(?<!^)(?=[A-Z])/g, '_').replace(/_+/g, '_').toUpperCase();
}

/**
 * The character's base pre-run loadout (plan §43.8): starting deck, starter
 * relic, starting HP and gold, plus Ascender's Bane at A5+. Neow/opening
 * choices are applied by the user through the normal live controls.
 */
export function starterState(characterId, ascension) {
  const ch = game.characters.get(characterId);
  if (!ch) return null;

  const counts = new Map();
  for (const raw of ch.starting_deck || []) {
    const id = normalizeId(raw);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (ascension >= ASCENDERS_BANE_LEVEL && game.cards.has(ASCENDERS_BANE_ID)) {
    counts.set(ASCENDERS_BANE_ID, (counts.get(ASCENDERS_BANE_ID) || 0) + 1);
  }

  return {
    deck: [...counts].map(([cardId, normal]) => ({ cardId, normal, upgraded: 0 })),
    relics: (ch.starting_relics || []).map(normalizeId),
    maxHp: ch.starting_hp ?? null,
    hp: ch.starting_hp ?? null,
    gold: ch.starting_gold ?? null,
  };
}

/** Applies the starter preset to a player, replacing any existing build. */
export function seedPlayer(player, characterId, ascension = state.game.ascension) {
  const s = starterState(characterId, ascension);
  player.character = characterId;
  if (!s) return player;
  player.deck = s.deck;
  player.relics = s.relics;
  player.maxHp = s.maxHp;
  player.hp = s.hp;
  player.gold = s.gold;
  player.touched = false;
  return player;
}

export function resetToStarter(playerId) {
  const p = playerById(playerId);
  if (p?.character) seedPlayer(p, p.character);
  emit();
}

export function startEmpty(playerId) {
  const p = playerById(playerId);
  if (!p) return;
  p.deck = []; p.relics = []; p.touched = true;
  emit();
}

/** True when the build still matches what seeding produced (safe to replace silently). */
export function isUntouched(player) {
  return !player.touched;
}

/* --------------------------------------------------------- deck mutations */

function markTouched(p) { p.touched = true; }

export function addCard(playerId, cardId, { upgraded = false, count = 1 } = {}) {
  const p = playerById(playerId);
  if (!p) return;
  const key = upgraded ? 'upgraded' : 'normal';
  let entry = p.deck.find((d) => d.cardId === cardId);
  if (!entry) { entry = { cardId, normal: 0, upgraded: 0 }; p.deck.push(entry); }
  entry[key] += count;
  markTouched(p);
  emit();
}

export function removeCard(playerId, cardId, { upgraded = false, count = 1 } = {}) {
  const p = playerById(playerId);
  if (!p) return;
  const entry = p.deck.find((d) => d.cardId === cardId);
  if (!entry) return;
  const key = upgraded ? 'upgraded' : 'normal';
  entry[key] = Math.max(0, entry[key] - count);
  if (entry.normal === 0 && entry.upgraded === 0) p.deck = p.deck.filter((d) => d !== entry);
  markTouched(p);
  emit();
}

/** Moves one copy from unupgraded to upgraded. */
export function upgradeCard(playerId, cardId) {
  const p = playerById(playerId);
  const entry = p?.deck.find((d) => d.cardId === cardId);
  if (!entry || entry.normal < 1) return;
  entry.normal -= 1;
  entry.upgraded += 1;
  markTouched(p);
  emit();
}

export function downgradeCard(playerId, cardId) {
  const p = playerById(playerId);
  const entry = p?.deck.find((d) => d.cardId === cardId);
  if (!entry || entry.upgraded < 1) return;
  entry.upgraded -= 1;
  entry.normal += 1;
  markTouched(p);
  emit();
}

export function addRelic(playerId, relicId) {
  const p = playerById(playerId);
  if (!p || p.relics.includes(relicId)) return;
  p.relics.push(relicId);
  markTouched(p);
  emit();
}

export function removeRelic(playerId, relicId) {
  const p = playerById(playerId);
  if (!p) return;
  p.relics = p.relics.filter((r) => r !== relicId);
  markTouched(p);
  emit();
}

/** Total cards including duplicates — the number that drives bloat/skip logic. */
export function deckSize(player) {
  return player.deck.reduce((n, d) => n + d.normal + d.upgraded, 0);
}

/* --------------------------------------------------------- party mutations */

export function setMode(mode) {
  state.game.mode = mode;
  if (mode === 'multiplayer' && state.players.length < 2) {
    setPartySize(2);
    return;
  }
  if (mode !== 'multiplayer' && state.players.length > 1) {
    state.players = [primary()];
    state.primaryPlayerId = state.players[0].id;
  }
  emit();
}

export function setPartySize(n) {
  const cur = state.players.length;
  if (n > cur) {
    for (let i = cur; i < n; i += 1) {
      const p = newPlayer(`p${i + 1}`, `Player ${i + 1}`);
      p.entryMode = 'quick';
      state.players.push(p);
    }
  } else if (n < cur) {
    const kept = state.players.slice(0, n);
    state.players = kept;
    if (!kept.some((p) => p.id === state.primaryPlayerId)) state.primaryPlayerId = kept[0].id;
  }
  emit();
}

export function setPrimary(playerId) {
  if (playerById(playerId)) { state.primaryPlayerId = playerId; emit(); }
}

/* ------------------------------------------------------------ reward flow */

export function setCandidates(ids) {
  state.currentChoice.candidates = ids.map((c) => (typeof c === 'string' ? { cardId: c, upgraded: false } : c));
  emit();
}

export function addCandidate(cardId, upgraded = false) {
  if (state.currentChoice.candidates.length >= 6) return;
  state.currentChoice.candidates.push({ cardId, upgraded });
  emit();
}

export function removeCandidate(index) {
  state.currentChoice.candidates.splice(index, 1);
  emit();
}

export function clearCandidates() {
  state.currentChoice.candidates = [];
  emit();
}

/** "I picked this" — adds the card to the live deck and clears the reward. */
export function takeCandidate(index) {
  const c = state.currentChoice.candidates[index];
  if (!c) return;
  clearCandidates();
  addCard(state.primaryPlayerId, c.cardId, { upgraded: c.upgraded });
}

/* ------------------------------------------------------------- run context */

export function patchGame(patch) { Object.assign(state.game, patch); emit(); }

export function patchPlayer(playerId, patch) {
  const p = playerById(playerId);
  if (!p) return;
  Object.assign(p, patch);
  emit();
}

export function nextFloor() {
  state.game.floor += 1;
  emit();
}

export function nextAct() {
  state.game.act = Math.min(4, state.game.act + 1);
  emit();
}

/* ------------------------------------------------------------- persistence */

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => saveRun(state), 250);
}

export function restore() {
  const saved = loadRun();
  if (!saved || saved.schemaVersion !== SCHEMA_VERSION) return false;
  state = { ...newRunState(), ...saved };
  return true;
}

export function discardRun() {
  clearRun();
  state = newRunState();
  emit();
}

export function exportRun() {
  return JSON.stringify(state, null, 2);
}

export function importRun(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.players)) {
    throw new Error('That file does not look like a saved run.');
  }
  state = { ...newRunState(), ...parsed, schemaVersion: SCHEMA_VERSION };
  emit();
  return state;
}
