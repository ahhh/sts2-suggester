/**
 * Which cards and relics may appear where.
 *
 * Reward pools are character-scoped, and multiplayer-only cards must not show
 * up in a solo run (plan §4.1).
 */

import { game, API_BASE } from './data.js';

const NEVER_IN_DECK = new Set(['Token', 'Quest']);

/**
 * The card colour a character draws from ("silent", "ironclad", ...).
 *
 * Note: a character record's own `color` field is a *display* colour
 * ("green" for Silent, "blue" for Defect). Card and relic pools key off the
 * lowercased character id instead.
 */
export function colorOf(characterId) {
  return String(characterId || '').toLowerCase();
}

/**
 * @param {string} characterId
 * @param {'singleplayer'|'multiplayer'|'daily'} mode
 * @param {'reward'|'deck'} purpose  reward pools exclude curses and statuses;
 *   deck entry includes them, because runs acquire them.
 * @param {{allColors?: boolean}} opts  `allColors` drops the character
 *   restriction, for the relics and events that hand you another character's
 *   cards. Off by default: the normal pool is the honest one.
 */
export function cardPool(characterId, mode, purpose = 'reward', { allColors = false } = {}) {
  const color = colorOf(characterId);
  return game.cardList.filter((c) => {
    if (c.multiplayer_only && mode !== 'multiplayer') return false;
    const rarity = c.rarity_key || c.rarity;
    if (NEVER_IN_DECK.has(rarity)) return false;

    const own = c.color === color || c.color === 'colorless' || (allColors && isCharacterColor(c.color));
    if (purpose === 'reward') {
      if (rarity === 'Curse' || rarity === 'Status') return false;
      return own;
    }
    // Deck entry: your colour, colourless, plus anything a run can inflict.
    return own || c.color === 'curse' || c.color === 'status' || c.color === 'event';
  });
}

/** True for a playable character's colour, as opposed to curse/status/event. */
export function isCharacterColor(color) {
  const c = String(color || '').toLowerCase();
  for (const id of game.characters.keys()) if (colorOf(id) === c) return true;
  return false;
}

/** "Silent" for `silent`, so an off-colour card says whose it is. */
export function colorLabel(color) {
  const c = String(color || '').toLowerCase();
  for (const ch of game.characters.values()) {
    if (colorOf(ch.id) === c) return ch.name.replace(/^The /, '');
  }
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
}

/** How many cards the character restriction is currently hiding. */
export function offColorCount(characterId, mode, purpose) {
  return cardPool(characterId, mode, purpose, { allColors: true }).length
    - cardPool(characterId, mode, purpose).length;
}

export function relicPool(characterId) {
  const color = colorOf(characterId);
  return game.relicList.filter((r) => {
    const pool = (r.pool || 'shared').toLowerCase();
    return pool === 'shared' || pool === color || pool === 'any';
  });
}

/** Absolute URL for an image the API gives us relative. */
export function imageUrl(entity) {
  if (entity.image_url_card) return entity.image_url_card;
  if (entity.image_url) {
    return entity.image_url.startsWith('http') ? entity.image_url : API_BASE + entity.image_url;
  }
  return null;
}

/**
 * Ranked substring search over name, rules text, type, rarity and mechanic
 * tags, so "discard" or "poison" surfaces mechanically relevant cards (plan §44).
 */
export function search(pool, query, filters = {}) {
  const q = query.trim().toLowerCase();
  let out = pool;

  if (filters.type) out = out.filter((e) => (e.type_key || e.type) === filters.type);
  if (filters.rarity) out = out.filter((e) => (e.rarity_key || e.rarity) === filters.rarity);
  if (filters.cost != null) {
    out = out.filter((e) => (filters.cost === 'x' ? e.cost === -1 : e.cost === filters.cost));
  }

  if (!q) return out.slice().sort(byName);

  const scored = [];
  for (const e of out) {
    const name = e.name.toLowerCase();
    let rank = null;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (e.searchText?.includes(q)) rank = 3;
    else if ([...(e.traits || [])].some((t) => t.includes(q))) rank = 4;
    if (rank !== null) scored.push([rank, e]);
  }
  return scored.sort((a, b) => a[0] - b[0] || byName(a[1], b[1])).map(([, e]) => e);
}

const byName = (a, b) => a.name.localeCompare(b.name);
