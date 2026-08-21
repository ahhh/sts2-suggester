/**
 * Regenerates data/fallback.json — the offline snapshot the app falls back to
 * when the Spire Codex API is unreachable (plan §49).
 *
 * Run:  node tools/build-fallback.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://spire-codex.com';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'fallback.json');

const get = async (p) => {
  const res = await fetch(API + p);
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
};

const pick = (o, keys) => {
  const r = {};
  for (const k of keys) if (o[k] !== null && o[k] !== undefined && !(Array.isArray(o[k]) && !o[k].length)) r[k] = o[k];
  return r;
};

const CARD_KEYS = ['id', 'name', 'description', 'cost', 'type', 'type_key', 'rarity', 'rarity_key',
  'color', 'damage', 'block', 'hit_count', 'cards_draw', 'energy_gain', 'hp_loss', 'keywords',
  'keywords_key', 'tags', 'powers_applied', 'spawns_cards', 'target', 'is_x_cost', 'is_x_star_cost',
  'multiplayer_only', 'upgrade_description', 'image_url_card', 'compendium_order'];
const RELIC_KEYS = ['id', 'name', 'description', 'flavor', 'rarity', 'rarity_key', 'pool',
  'merchant_price', 'image_url', 'compendium_order'];
const CHAR_KEYS = ['id', 'name', 'description', 'starting_hp', 'starting_gold', 'max_energy',
  'orb_slots', 'starting_deck', 'starting_relics', 'color'];
const METRIC_KEYS = ['id', 'upgraded', 'score', 'tier', 'elo', 'win_rate', 'pick_rate', 'picks',
  'wins', 'offered', 'picked', 'pick_rate_by_act'];

const trimMetrics = (m) => ({
  bracket: m.bracket, character: m.character,
  baseline_win_rate: m.baseline_win_rate, total_runs: m.total_runs,
  rows: m.rows.map((r) => pick(r, METRIC_KEYS)),
});

const [cards, relics, characters, mCards, mRelics] = await Promise.all([
  get('/api/cards'), get('/api/relics'), get('/api/characters'),
  get('/api/runs/metrics/cards'), get('/api/runs/metrics/relics'),
]);

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: API,
  characters: characters.map((c) => pick(c, CHAR_KEYS)),
  cards: cards.map((c) => pick(c, CARD_KEYS)),
  relics: relics.map((r) => pick(r, RELIC_KEYS)),
  metrics: { cards: trimMetrics(mCards), relics: trimMetrics(mRelics) },
};

fs.writeFileSync(OUT, JSON.stringify(snapshot));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`wrote ${OUT}`);
console.log(`  ${snapshot.characters.length} characters, ${snapshot.cards.length} cards, ${snapshot.relics.length} relics`);
console.log(`  metrics: ${snapshot.metrics.cards.rows.length} card rows, ${snapshot.metrics.relics.rows.length} relic rows`);
console.log(`  ${kb} KB`);
