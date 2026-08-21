/**
 * Game data + statistics adapter.
 *
 * The recommendation engine never touches a URL. It asks this module for cards,
 * relics and metrics; this module decides whether that comes from the live
 * Spire Codex API, the IndexedDB cache, or the bundled offline snapshot
 * (plan §13 / §30 / §31 / §49).
 *
 * Swap SpireCodexProvider for another StatsProvider and nothing above it changes.
 */

import { extractTags } from './tags.js';
import { cacheGet, cachePut } from './storage.js';

export const API_BASE = 'https://spire-codex.com';
const FALLBACK_URL = new URL('../data/fallback.json', import.meta.url).href;

/** Cached API responses older than this are refreshed in the background. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Below this many observations a bracket's numbers are not trusted on their own. */
export const MIN_SAMPLE = 400;

/**
 * Statistical brackets the provider exposes. `weightPenalty` shrinks confidence
 * for slices we know are thin or unrepresentative.
 */
export const BRACKETS = [
  { id: 'all', label: 'Community — all runs', hint: 'Every submitted run. Largest sample.' },
  { id: 'solo', label: 'Singleplayer only', hint: 'Solo runs only. The cleanest read for a solo climb.' },
  { id: '2p', label: '2-player co-op', hint: 'Two-player parties only.' },
  { id: '3p', label: '3-player co-op', hint: 'Three-player parties only.' },
  { id: '4p', label: '4-player co-op', hint: 'Four-player parties only.' },
  { id: 'a10', label: 'Ascension 10+', hint: 'High-ascension runs.' },
  { id: 'daily', label: 'Daily climbs', hint: 'Daily runs only. Smaller sample.' },
  { id: 'wr50', label: 'Strong players (50%+ WR)', hint: 'Runs by players winning half their games.' },
  { id: 'wr75', label: 'Top players (75%+ WR)', hint: 'Very small sample, very strong play.' },
];

/** Where the data on screen actually came from — surfaced as a badge in the UI. */
export const dataStatus = {
  source: 'loading', // 'live' | 'cache' | 'offline'
  fetchedAt: null,
  note: '',
};

/* ------------------------------------------------------------------ adapter */

export class StatsProvider {
  async getCards() { throw new Error('not implemented'); }
  async getRelics() { throw new Error('not implemented'); }
  async getCharacters() { throw new Error('not implemented'); }
  async getMetrics(/* entityType, bracket */) { throw new Error('not implemented'); }
}

let offlineSnapshot = null;
async function getOfflineSnapshot() {
  if (!offlineSnapshot) offlineSnapshot = await fetch(FALLBACK_URL).then((r) => r.json());
  return offlineSnapshot;
}

export class SpireCodexProvider extends StatsProvider {
  /**
   * Cache-first with a network revalidate. Any network failure degrades to the
   * cache, then to the bundled snapshot — a run in progress is never lost to a
   * flaky API.
   */
  async #fetchCached(pathname, offlineKey) {
    const cached = await cacheGet(pathname);
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    if (fresh) {
      noteSource('cache', cached.fetchedAt);
      return cached.data;
    }
    try {
      const res = await fetch(API_BASE + pathname, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${pathname} -> ${res.status}`);
      const data = await res.json();
      await cachePut(pathname, data);
      noteSource('live', Date.now());
      return data;
    } catch (err) {
      if (cached) {
        noteSource('cache', cached.fetchedAt, 'API unreachable — showing cached data.');
        return cached.data;
      }
      const snap = await getOfflineSnapshot();
      noteSource('offline', Date.parse(snap.generatedAt), 'API unreachable — using the bundled snapshot.');
      return offlineKey(snap);
    }
  }

  getCards() { return this.#fetchCached('/api/cards', (s) => s.cards); }

  getRelics() { return this.#fetchCached('/api/relics', (s) => s.relics); }

  getCharacters() { return this.#fetchCached('/api/characters', (s) => s.characters); }

  getMetrics(entityType, bracket = 'all') {
    const q = bracket && bracket !== 'all' ? `?bracket=${encodeURIComponent(bracket)}` : '';
    return this.#fetchCached(`/api/runs/metrics/${entityType}${q}`, (s) => s.metrics[entityType]);
  }
}

/** Worst source wins, so the badge never overstates freshness. */
const RANK = { live: 0, cache: 1, offline: 2, loading: -1 };
function noteSource(source, fetchedAt, note = '') {
  if (RANK[source] >= RANK[dataStatus.source]) {
    dataStatus.source = source;
    dataStatus.fetchedAt = fetchedAt;
    dataStatus.note = note;
  }
}

export const provider = new SpireCodexProvider();

/* --------------------------------------------------------------- game index */

/** @typedef {{id:string,name:string,traits:Set<string>,wants:Set<string>,roles:object}} Entity */

export const game = {
  cards: new Map(),      // id -> enriched card
  relics: new Map(),     // id -> enriched relic
  characters: new Map(), // id -> character (with starting deck/relics/hp)
  cardList: [],
  relicList: [],
  loaded: false,
};

/** Cards that can never appear in a reward and should not clutter search. */
const NON_PICKABLE_RARITIES = new Set(['Status', 'Token', 'Quest']);

export async function loadGameData() {
  const [cards, relics, characters] = await Promise.all([
    provider.getCards(), provider.getRelics(), provider.getCharacters(),
  ]);

  game.cards.clear(); game.relics.clear(); game.characters.clear();

  for (const c of cards) {
    const tags = extractTags(c, 'card');
    const enriched = {
      ...c,
      traits: tags.traits,
      wants: tags.wants,
      roles: tags.roles,
      kind: 'card',
      searchText: searchBlob(c),
      pickable: !NON_PICKABLE_RARITIES.has(c.rarity_key || c.rarity),
    };
    game.cards.set(c.id, enriched);
  }

  for (const r of relics) {
    const tags = extractTags(r, 'relic');
    game.relics.set(r.id, {
      ...r, traits: tags.traits, wants: tags.wants, roles: tags.roles,
      kind: 'relic', searchText: searchBlob(r),
    });
  }

  for (const ch of characters) game.characters.set(ch.id, ch);

  game.cardList = [...game.cards.values()];
  game.relicList = [...game.relics.values()];
  game.loaded = true;
  return game;
}

/** Name + rules text + tags, so "discard" or "poison" finds mechanically relevant cards (plan §44). */
function searchBlob(e) {
  return [
    e.name, e.description, e.type, e.rarity, e.color, e.pool,
    ...(e.keywords || []), ...(e.tags || []),
  ].filter(Boolean).join(' ').replace(/\[\/?[a-z]+\]/gi, ' ').toLowerCase();
}

/* ------------------------------------------------------------------ metrics */

/**
 * @typedef {object} MetricRow
 * @property {number} score      Codex Score, 0-100
 * @property {number} winRate    percent
 * @property {number} pickRate   percent of times taken when offered
 * @property {number} picks      observations
 * @property {number[]} pickRateByAct
 */

/**
 * A metrics table plus the machinery for widening to a broader bracket when the
 * selected one is too thin for a given card (plan §4.3).
 */
export class MetricsTable {
  constructor(selected, base) {
    this.selected = index(selected);
    this.base = index(base);
    this.bracket = selected.bracket;
    this.baselineWinRate = selected.baseline_win_rate;
    this.baseBaselineWinRate = base.baseline_win_rate;
    this.totalRuns = selected.total_runs;
  }

  /**
   * @returns {{row:MetricRow|null, baseline:number, fellBack:boolean, bracket:string}}
   */
  get(id, upgraded = false) {
    const key = upgraded ? 'upg' : 'base';
    const sel = this.selected.get(id)?.[key] ?? this.selected.get(id)?.base ?? null;
    if (sel && sel.picks >= MIN_SAMPLE) {
      return { row: sel, baseline: this.baselineWinRate, fellBack: false, bracket: this.bracket };
    }
    const wide = this.base.get(id)?.[key] ?? this.base.get(id)?.base ?? null;
    if (wide && (!sel || wide.picks > (sel.picks || 0))) {
      return { row: wide, baseline: this.baseBaselineWinRate, fellBack: this.bracket !== 'all', bracket: 'all' };
    }
    return { row: sel, baseline: this.baselineWinRate, fellBack: false, bracket: this.bracket };
  }
}

function index(table) {
  const m = new Map();
  for (const r of table.rows || []) {
    const row = {
      score: r.score, tier: r.tier, elo: r.elo,
      winRate: r.win_rate, pickRate: r.pick_rate,
      picks: r.picks || 0, wins: r.wins || 0,
      offered: r.offered || 0, picked: r.picked || 0,
      pickRateByAct: r.pick_rate_by_act || [],
    };
    const slot = m.get(r.id) || {};
    slot[r.upgraded ? 'upg' : 'base'] = row;
    m.set(r.id, slot);
  }
  return m;
}

const metricsCache = new Map();

/** Loads the selected bracket alongside `all`, which backs the widening fallback. */
export async function loadMetrics(entityType, bracket = 'all') {
  const key = `${entityType}:${bracket}`;
  if (metricsCache.has(key)) return metricsCache.get(key);
  const p = (async () => {
    const [sel, base] = await Promise.all([
      provider.getMetrics(entityType, bracket),
      bracket === 'all' ? null : provider.getMetrics(entityType, 'all'),
    ]);
    return new MetricsTable(sel, base || sel);
  })();
  metricsCache.set(key, p);
  return p;
}

/** Default statistical bracket implied by the run itself. */
export function defaultBracket(runState) {
  const { mode, ascension } = runState.game;
  if (mode === 'daily') return 'daily';
  if (mode === 'multiplayer') {
    const n = runState.players.length;
    if (n >= 2 && n <= 4) return `${n}p`;
    return 'all';
  }
  if (ascension >= 10) return 'a10';
  return 'solo';
}
