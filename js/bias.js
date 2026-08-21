/**
 * Personal card weighting.
 *
 * Every other component of a score is either measured (community statistics)
 * or inferred (deck fit). This one is neither — it is you overruling both, and
 * the UI labels it as yours so the honesty of the breakdown survives.
 *
 * One step is worth exactly one Codex tier, up or down. The weighting is keyed
 * to the card rather than to the offer, and it lives in preferences rather than
 * in the run: a card you dislike is a card you dislike in every run.
 */

import { savePrefs, loadPrefs } from './storage.js';

/** How far a preference may push a card. Three tiers either way is plenty. */
export const MAX_BIAS = 3;

/** Codex tiers, worst to best. */
export const TIER_LADDER = ['F', 'D', 'C', 'B', 'A', 'S'];

/**
 * Score points between adjacent tiers, taken from the width of the Codex tier
 * bands. One click is one tier — that is the promise the control makes, so this
 * number is not free to be tuned for anything else.
 */
export const TIER_STEP = 13;

/** Removal is scored on its own raw scale, before a tanh squash. */
export const REMOVAL_STEP = 8;

let biases = Object.create(null);
let prefs = {};

/** Reads the saved weightings. Call once at boot, before the first render. */
export function loadBiases() {
  prefs = loadPrefs() || {};
  const saved = prefs.cardBias && typeof prefs.cardBias === 'object' ? prefs.cardBias : {};
  biases = Object.create(null);
  for (const [id, n] of Object.entries(saved)) {
    const v = clampStep(Number(n));
    if (v) biases[id] = v;
  }
}

const clampStep = (n) => (Number.isFinite(n) ? Math.max(-MAX_BIAS, Math.min(MAX_BIAS, Math.round(n))) : 0);

/** @returns {number} -MAX_BIAS..MAX_BIAS. 0 means "no opinion". */
export function biasOf(cardId) { return biases[cardId] || 0; }

export function setBias(cardId, steps) {
  const n = clampStep(Number(steps));
  if (n) biases[cardId] = n; else delete biases[cardId];
  persist();
  return n;
}

/** Moves one tier in `dir` and returns the new level (clamped). */
export function nudgeBias(cardId, dir) {
  return setBias(cardId, biasOf(cardId) + dir);
}

export function clearBiases() { biases = Object.create(null); persist(); }

/** How many cards the user has an opinion about. */
export function biasCount() { return Object.keys(biases).length; }

export function biasEntries() { return Object.entries(biases); }

function persist() {
  prefs.cardBias = { ...biases };
  savePrefs(prefs);
}

/* --------------------------------------------------------------- tier maths */

/** The tier `steps` places along the ladder, or null if we cannot say. */
export function shiftTier(tier, steps) {
  const i = TIER_LADDER.indexOf(String(tier || '').toUpperCase());
  if (i < 0 || !steps) return null;
  const j = Math.max(0, Math.min(TIER_LADDER.length - 1, i + steps));
  return j === i ? null : TIER_LADDER[j];
}

/**
 * "C → B" when the card has a Codex tier to move, "two tiers up" when it does
 * not — the shift is real either way, we just cannot name the destination.
 */
export function tierShiftLabel(steps, tier) {
  if (!steps) return '';
  const to = shiftTier(tier, steps);
  if (to) return `${String(tier).toUpperCase()} → ${to}`;
  const n = Math.abs(steps);
  return `${n} tier${n > 1 ? 's' : ''} ${steps > 0 ? 'up' : 'down'}`;
}

/** Short badge text: `+2` / `−1`. */
export const biasBadge = (steps) => (steps > 0 ? `+${steps}` : steps < 0 ? `−${Math.abs(steps)}` : '');

export function biasWord(steps) {
  if (steps > 0) return steps >= 3 ? 'a favourite' : 'ranked up';
  if (steps < 0) return steps <= -3 ? 'blacklisted' : 'ranked down';
  return 'unweighted';
}
