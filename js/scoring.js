/**
 * The recommendation engine.
 *
 * Every score is `50 + sum(contributions)`, where each contribution is
 * `weight * (component - 50)` and each component is normalised to 0-100. That
 * makes the explanation panel an exact decomposition of the number rather than
 * a plausible-sounding story about it (plan §12 / §34).
 *
 * Provenance of each component:
 *   base      — real Spire Codex statistics (Codex Score, pick rate, win rate)
 *   context   — real per-act pick rates, plus deck-size heuristics
 *   upgrade   — real statistics (upgraded rows exist in the `all` bracket)
 *   synergy   — MECHANISTIC, not statistical. The API exposes no pairwise card
 *               data, so synergy is derived from what cards actually do.
 * The UI labels which is which; we never present a heuristic as a measurement.
 */

import { ARCHETYPE_TAGS, labelFor } from './tags.js';
import { game } from './data.js';
import { deckSize } from './state.js';

/** Component weights (plan §17). Mutable so the UI can expose tuning. */
export const WEIGHTS = {
  base: 0.38,
  deckSynergy: 0.30,
  relicSynergy: 0.10,
  context: 0.12,
  duplicate: 0.05,
  upgrade: 0.05,
};

/** Bayesian shrinkage prior: observations needed before stats move a score fully. */
const SHRINK_PRIOR = 1500;

/** Offers needed before a pick rate is treated as a real preference signal. */
const MIN_OFFERS = 200;

/** Rarity priors used only when a card has no statistics at all. */
const RARITY_PRIOR = { Basic: 38, Common: 46, Uncommon: 54, Rare: 62, Ancient: 66, Event: 52, Curse: 5, Status: 5 };

const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
/** Saturating 0-100 curve — the first few points of synergy matter most. */
const sat = (x, k) => 100 * (x / (x + k));

/* --------------------------------------------------------------- build profile */

/**
 * Collapses a player's deck and relics into trait/want weights and role totals.
 * Quantity uses sqrt so five Strikes do not drown out everything else (plan §19).
 */
export function buildProfile(player) {
  const traits = new Map();
  const wants = new Map();
  const roles = { damage: 0, aoe: 0, defense: 0, scaling: 0, draw: 0, energy: 0, debuff: 0, sustain: 0 };
  const traitSources = new Map(); // tag -> [card names], for explanations

  const bump = (map, tag, w) => map.set(tag, (map.get(tag) || 0) + w);

  for (const entry of player.deck) {
    const card = game.cards.get(entry.cardId);
    if (!card) continue;
    const qty = entry.normal + entry.upgraded;
    if (qty <= 0) continue;
    const w = Math.sqrt(qty);
    for (const t of card.traits) {
      bump(traits, t, w);
      if (!traitSources.has(t)) traitSources.set(t, []);
      if (traitSources.get(t).length < 4) traitSources.get(t).push(card.name);
    }
    for (const t of card.wants) bump(wants, t, w);
    for (const k of Object.keys(roles)) roles[k] += (card.roles[k] || 0) * qty;
  }

  for (const relicId of player.relics) {
    const relic = game.relics.get(relicId);
    if (!relic) continue;
    for (const t of relic.traits) {
      bump(traits, t, 1.2);
      if (!traitSources.has(t)) traitSources.set(t, []);
      if (traitSources.get(t).length < 4) traitSources.get(t).push(relic.name);
    }
    for (const t of relic.wants) bump(wants, t, 1.2);
    for (const k of Object.keys(roles)) roles[k] += (relic.roles[k] || 0) * 2;
  }

  const size = deckSize(player);
  return {
    traits, wants, roles, traitSources, deckSize: size,
    /** Roles expressed per-card so decks of different sizes compare fairly. */
    rolesPerCard: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, size ? v / size : 0])),
  };
}

/**
 * The Build Profile panel (plan §45): how well covered each job is, on 0-100.
 * Targets are per-card intensities that a functional deck tends to reach.
 */
const ROLE_TARGETS = { damage: 5.5, defense: 2.4, scaling: 1.6, draw: 0.5, energy: 0.6, debuff: 0.8, aoe: 1.6, sustain: 0.4 };
export const ROLE_LABELS = {
  damage: 'Damage', defense: 'Block', scaling: 'Scaling', draw: 'Card draw',
  energy: 'Energy', debuff: 'Debuffs', aoe: 'AoE', sustain: 'Sustain',
};

export function roleCoverage(profile) {
  return Object.entries(ROLE_TARGETS).map(([k, target]) => {
    const pct = clamp((profile.rolesPerCard[k] || 0) / target * 100, 0, 140);
    return {
      role: k,
      label: ROLE_LABELS[k],
      pct,
      status: pct >= 90 ? 'strong' : pct >= 55 ? 'ok' : pct >= 25 ? 'thin' : 'missing',
    };
  }).sort((a, b) => b.pct - a.pct);
}

/* -------------------------------------------------------------- base strength */

/**
 * Real community statistics, shrunk toward the field by sample size so a card
 * with 40 observations cannot outrank one with 40,000 (plan §18).
 */
export function baseStrength(card, upgraded, metrics, act) {
  const { row, baseline, fellBack, bracket } = metrics.get(card.id, upgraded);
  const rarity = card.rarity_key || card.rarity;
  const prior = RARITY_PRIOR[rarity] ?? 50;

  // Starter cards appear in every run, so their win rate is just the global
  // baseline and their "pick rate" comes from a handful of stray offers. The
  // statistics are an artefact of always being there — judge them on merit.
  if (rarity === 'Basic') {
    return {
      value: prior, samples: 0, fellBack: false, bracket, basis: 'starter card',
      detail: [{ label: 'Starter card', value: '—', note: 'in every run, so community win/pick rates say nothing about it' }],
    };
  }

  if (!row || !row.picks) {
    return { value: prior, samples: 0, fellBack, bracket, basis: 'rarity prior only', detail: [] };
  }

  const detail = [];

  // Codex Score: the provider's own normalised 0-100 quality grade.
  const scoreComp = row.score ?? prior;
  detail.push({ label: 'Codex Score', value: Math.round(scoreComp), note: row.tier ? `tier ${row.tier}` : '' });

  // Pick rate when offered: the community's revealed take-vs-skip preference.
  // Pick rate is only meaningful once the card has actually been offered a lot.
  const hasOffers = (row.offered || 0) >= MIN_OFFERS;
  const actPick = hasOffers ? row.pickRateByAct?.[act - 1] : null;
  const pickComp = hasOffers ? (actPick ?? row.pickRate) : null;
  if (pickComp != null) {
    detail.push({
      label: actPick != null ? `Pick rate (Act ${act})` : 'Pick rate',
      value: `${pickComp.toFixed(1)}%`,
      note: row.offered ? `${fmt(row.offered)} offers` : '',
    });
  }

  // Win rate only ever as a delta: baselines swing from 27% solo to 78% in 4p.
  let wrComp = null;
  if (row.winRate != null && baseline != null) {
    wrComp = clamp(50 + (row.winRate - baseline) * 2.2);
    detail.push({
      label: 'Win rate vs bracket',
      value: `${row.winRate.toFixed(1)}% vs ${baseline.toFixed(1)}%`,
      note: `${row.winRate >= baseline ? '+' : ''}${(row.winRate - baseline).toFixed(1)} pts`,
    });
  }

  let raw = 0; let wsum = 0;
  const add = (v, w) => { if (v != null && Number.isFinite(v)) { raw += v * w; wsum += w; } };
  add(scoreComp, 0.5);
  add(pickComp, 0.3);
  add(wrComp, 0.2);
  raw = wsum ? raw / wsum : prior;

  const k = row.picks / (row.picks + SHRINK_PRIOR);
  const value = clamp(prior + (raw - prior) * k);

  return { value, samples: row.picks, fellBack, bracket, row, basis: 'community statistics', detail };
}

/* ------------------------------------------------------------- deck synergy */

/**
 * Mechanistic synergy. Three channels:
 *   payoff   — the candidate is paid off by what the deck already does
 *   enabler  — the candidate feeds a payoff the deck already has
 *   cohesion — both push the same archetype axis, so concentration compounds
 */
export function deckSynergy(card, profile) {
  const hits = [];
  let raw = 0;

  for (const want of card.wants) {
    const have = profile.traits.get(want) || 0;
    if (have <= 0) continue;
    const v = Math.min(have, 6) * 1.9;
    raw += v;
    hits.push({ tag: want, kind: 'payoff', value: v, sources: profile.traitSources.get(want) || [] });
  }

  for (const trait of card.traits) {
    const wanted = profile.wants.get(trait) || 0;
    if (wanted <= 0) continue;
    const v = Math.min(wanted, 6) * 1.6;
    raw += v;
    hits.push({ tag: trait, kind: 'enabler', value: v, sources: [] });
  }

  for (const trait of card.traits) {
    if (!ARCHETYPE_TAGS.has(trait)) continue;
    const have = profile.traits.get(trait) || 0;
    if (have <= 0.9) continue;
    const v = Math.min(have, 6) * 0.85;
    raw += v;
    hits.push({ tag: trait, kind: 'cohesion', value: v, sources: profile.traitSources.get(trait) || [] });
  }

  // Merge duplicate tags so the explanation lists each mechanic once.
  const merged = new Map();
  for (const h of hits) {
    const cur = merged.get(h.tag);
    if (cur) { cur.value += h.value; cur.kinds.add(h.kind); if (!cur.sources.length) cur.sources = h.sources; }
    else merged.set(h.tag, { tag: h.tag, value: h.value, kinds: new Set([h.kind]), sources: h.sources });
  }

  const contributions = [...merged.values()]
    .sort((a, b) => b.value - a.value)
    .map((h) => ({
      tag: h.tag,
      label: labelFor(h.tag),
      kind: [...h.kinds][0],
      sources: h.sources,
      share: h.value,
    }));

  // An empty deck is neutral, not bad.
  const value = profile.deckSize === 0 ? 50 : clamp(40 + sat(raw, 16) * 0.6);
  return { value, contributions, raw };
}

/* ------------------------------------------------------------ relic synergy */

/** Relics whose rules text actively punishes a play pattern (plan §20). */
const RELIC_ANTI_RULES = [
  { re: /cannot play more than|only play \d+ card/i, tags: ['zero-cost', 'card-count', 'card-gen', 'draw'], label: 'card-play limit' },
  { re: /cannot gain block|no longer gain block/i, tags: ['block'], label: 'blocks Block' },
  { re: /cannot heal|no longer heal/i, tags: ['heal'], label: 'blocks healing' },
  { re: /cannot draw|draw \d+ fewer/i, tags: ['draw'], label: 'reduces draw' },
];

export function relicSynergy(card, player) {
  const hits = [];
  let raw = 0;

  for (const relicId of player.relics) {
    const relic = game.relics.get(relicId);
    if (!relic) continue;

    let v = 0;
    for (const want of card.wants) if (relic.traits.has(want)) v += 2.2;
    for (const trait of card.traits) if (relic.wants.has(trait)) v += 2.6;
    for (const trait of card.traits) if (ARCHETYPE_TAGS.has(trait) && relic.traits.has(trait)) v += 1.1;

    let penalty = 0;
    const text = `${relic.description || ''}`;
    for (const rule of RELIC_ANTI_RULES) {
      if (!rule.re.test(text)) continue;
      for (const t of rule.tags) if (card.traits.has(t)) penalty += 3.2;
    }

    if (v > 0 || penalty > 0) {
      hits.push({ relicId, name: relic.name, value: v - penalty });
      raw += v - penalty;
    }
  }

  const contributions = hits.filter((h) => Math.abs(h.value) > 0.4).sort((a, b) => b.value - a.value);
  const pos = Math.max(0, raw);
  const neg = Math.max(0, -raw);
  const value = clamp(50 + sat(pos, 9) * 0.5 - sat(neg, 9) * 0.5);
  return { value, contributions };
}

/* ------------------------------------------------------------- run context */

export function runContext(card, profile, runState, base) {
  const notes = [];
  let value = 50;
  const { act } = runState.game;
  const player = runState.players.find((p) => p.id === runState.primaryPlayerId);

  // Real signal: does the community take this card more or less often in this act?
  const byAct = (base.row?.offered || 0) >= MIN_OFFERS ? base.row?.pickRateByAct : null;
  const overall = base.row?.pickRate;
  if (byAct?.[act - 1] != null && overall) {
    const delta = byAct[act - 1] - overall;
    value += clamp(delta * 0.8, -18, 18);
    if (Math.abs(delta) >= 3) {
      notes.push({
        label: `Act ${act} demand`,
        detail: `community takes this ${delta > 0 ? 'more' : 'less'} often in Act ${act} (${byAct[act - 1].toFixed(0)}% vs ${overall.toFixed(0)}% overall)`,
        value: clamp(delta * 0.8, -18, 18),
      });
    }
  }

  // A bloated deck raises the bar for anything that is not a real upgrade.
  const bloat = Math.max(0, profile.deckSize - 24);
  if (bloat > 0) {
    const v = -Math.min(bloat * 0.9, 14);
    value += v;
    notes.push({ label: 'Deck size', detail: `${profile.deckSize} cards — dilution is starting to cost you`, value: v });
  }

  // Fill the build's weakest job.
  const coverage = roleCoverage(profile);
  const weak = coverage.filter((c) => c.pct < 55).map((c) => c.role);
  const fills = weak.filter((r) => (card.roles[r] || 0) > 0);
  if (fills.length && profile.deckSize > 6) {
    const v = Math.min(fills.length * 5, 12);
    value += v;
    notes.push({
      label: 'Fills a gap',
      detail: `your build is thin on ${fills.map((r) => ROLE_LABELS[r].toLowerCase()).join(' and ')}`,
      value: v,
    });
  }

  // Low HP shifts value toward not dying.
  if (player?.hp != null && player?.maxHp) {
    const frac = player.hp / player.maxHp;
    if (frac < 0.4 && (card.traits.has('block') || card.traits.has('heal'))) {
      value += 6;
      notes.push({ label: 'Low HP', detail: `at ${player.hp}/${player.maxHp}, defence is worth more right now`, value: 6 });
    }
  }

  return { value: clamp(value), notes };
}

/* ----------------------------------------------------- duplicate & upgrade */

export function duplicateValue(card, player) {
  const entry = player.deck.find((d) => d.cardId === card.id);
  const copies = entry ? entry.normal + entry.upgraded : 0;
  if (copies === 0) return { value: 50, note: null };

  // Cards that scale with their own archetype keep wanting copies; unique
  // effects and Powers mostly do not.
  const selfSynergistic = [...card.traits].some((t) => ARCHETYPE_TAGS.has(t) && card.wants.has(t));
  const isPower = (card.type_key || card.type) === 'Power';
  const penaltyPer = isPower ? 22 : selfSynergistic ? 7 : 14;
  const value = clamp(50 - copies * penaltyPer);
  return {
    value,
    note: `you already run ${copies} ${copies === 1 ? 'copy' : 'copies'}${isPower ? ' — Powers rarely want duplicates' : ''}`,
  };
}

/** Real data: the `all` bracket carries separate rows for upgraded copies. */
export function upgradeValue(card, upgraded, metrics) {
  if (!upgraded) return { value: 50, note: null };
  const up = metrics.get(card.id, true);
  const base = metrics.get(card.id, false);
  if (!up.row || !base.row || up.row.score == null || base.row.score == null) {
    return { value: 58, note: 'already upgraded' };
  }
  const delta = up.row.score - base.row.score;
  return {
    value: clamp(50 + delta * 0.9),
    note: `upgraded copy — Codex Score ${base.row.score} → ${up.row.score}`,
  };
}

/* -------------------------------------------------------- party adjustment */

/**
 * Multiplayer only. Deliberately additive and capped (plan §4.2): party synergy
 * nudges the ranking, it never replaces intrinsic card strength.
 */
export function partyAdjustment(card, runState) {
  if (runState.game.mode !== 'multiplayer') return { value: 0, contributions: [], context: 'none' };

  const mates = runState.players.filter((p) => p.id !== runState.primaryPlayerId);
  if (!mates.length) return { value: 0, contributions: [], context: 'none' };

  const contributions = [];
  let value = 0;

  if (card.multiplayer_only) {
    value += 6;
    contributions.push({ label: 'Multiplayer-only card', detail: 'only exists in co-op, and is priced for it', value: 6 });
  }

  if (card.traits.has('ally-buff')) {
    const fragile = mates.filter((m) => m.hp != null && m.maxHp && m.hp / m.maxHp < 0.5).length;
    const v = 4 + fragile * 3;
    value += v;
    contributions.push({
      label: 'Supports allies',
      detail: fragile ? `${fragile} teammate${fragile > 1 ? 's are' : ' is'} below half HP` : `${mates.length} teammate${mates.length > 1 ? 's' : ''} to support`,
      value: v,
    });
  }

  // Teammate builds and declared roles both feed cross-player synergy.
  let known = 0;
  for (const mate of mates) {
    const mateProfile = buildProfile(mate);
    if (mate.deck.length) known += 1;
    let v = 0;
    const shared = [];
    for (const trait of card.traits) {
      if ((mateProfile.wants.get(trait) || 0) > 0) { v += 2.0; shared.push(labelFor(trait)); }
    }
    for (const want of card.wants) {
      if ((mateProfile.traits.get(want) || 0) > 0) { v += 1.2; shared.push(labelFor(want)); }
    }
    if (v > 0) {
      const capped = Math.min(v, 7);
      value += capped;
      contributions.push({
        label: `${mate.label} synergy`,
        detail: `${[...new Set(shared)].slice(0, 3).join(', ')}`,
        value: capped,
      });
    }

    // Role-based reasoning works even when the teammate's deck is unknown.
    if (mate.roleTags?.includes('Damage') && card.traits.has('debuff')) {
      value += 3;
      contributions.push({ label: `${mate.label} is the damage`, detail: 'debuffs multiply someone else’s hits', value: 3 });
    }
    if (mate.roleTags?.includes('Block') && card.traits.has('aoe')) {
      value += 2;
      contributions.push({ label: `${mate.label} holds the line`, detail: 'you are free to push AoE damage', value: 2 });
    }
  }

  const context = known === mates.length && known > 0 ? 'high'
    : mates.some((m) => m.deck.length || m.roleTags?.length) ? 'medium' : 'low';

  return { value: Math.min(value, 20), contributions, context };
}

/* ------------------------------------------------------------ card scoring */

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/**
 * @returns {{total:number, contributions:Array, components:object, confidence:object}}
 */
export function scoreCandidate(cardId, upgraded, ctx) {
  const card = game.cards.get(cardId);
  if (!card) return null;

  const base = baseStrength(card, upgraded, ctx.cardMetrics, ctx.state.game.act);
  const synergy = deckSynergy(card, ctx.profile);
  const relics = relicSynergy(card, ctx.player);
  const context = runContext(card, ctx.profile, ctx.state, base);
  const dup = duplicateValue(card, ctx.player);
  const upg = upgradeValue(card, upgraded, ctx.cardMetrics);
  const party = partyAdjustment(card, ctx.state);

  const components = {
    base: base.value,
    deckSynergy: synergy.value,
    relicSynergy: relics.value,
    context: context.value,
    duplicate: dup.value,
    upgrade: upg.value,
  };

  const contributions = Object.entries(WEIGHTS).map(([key, w]) => ({
    key,
    label: CONTRIB_LABELS[key],
    delta: w * (components[key] - 50),
    component: components[key],
    weight: w,
  })).filter((c) => Math.abs(c.delta) >= 0.05);

  let total = 50 + contributions.reduce((s, c) => s + c.delta, 0);
  if (party.value) {
    contributions.push({ key: 'party', label: 'Party synergy', delta: party.value, component: null, weight: null });
    total += party.value;
  }
  contributions.sort((a, b) => b.delta - a.delta);

  return {
    cardId, card, upgraded,
    total: clamp(total),
    components,
    contributions,
    detail: { base, synergy, relics, context, dup, upg, party },
    confidence: confidenceOf(base, ctx, party),
  };
}

const CONTRIB_LABELS = {
  base: 'Community card strength',
  deckSynergy: 'Deck synergy',
  relicSynergy: 'Relic synergy',
  context: 'Run context',
  duplicate: 'Duplicate impact',
  upgrade: 'Upgrade value',
};

/**
 * Confidence reflects how much real evidence sits behind the number — sample
 * size, whether we had to widen the bracket, and how completely the run has
 * been entered. We never invent an observation count (plan §33).
 */
function confidenceOf(base, ctx, party) {
  const reasons = [];
  let score = 0;

  if (base.samples >= 5000) { score += 3; reasons.push(`${fmt(base.samples)} observations`); }
  else if (base.samples >= 500) { score += 2; reasons.push(`${fmt(base.samples)} observations`); }
  else if (base.samples > 0) { score += 1; reasons.push(`only ${fmt(base.samples)} observations`); }
  else reasons.push('no community data for this card yet');

  if (base.fellBack) { score -= 1; reasons.push(`widened to the all-runs bracket for sample size`); }
  if (ctx.profile.deckSize < 8) { score -= 1; reasons.push('deck looks incomplete'); }
  if (ctx.state.game.mode === 'multiplayer' && party.context === 'low') {
    score -= 1; reasons.push('teammate builds not entered');
  }

  const level = score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
  return { level, reasons };
}

/* ---------------------------------------------------------- reward ranking */

/**
 * Skip is a first-class candidate (plan §23), and it is grounded in real data:
 * the community's pick rate when a card is offered *is* its skip rate.
 */
export function scoreSkip(results, ctx) {
  const notes = [];
  let value = 50;

  const bloat = Math.max(0, ctx.profile.deckSize - 22);
  if (bloat > 0) {
    const v = Math.min(bloat * 1.7, 24);
    value += v;
    notes.push({ label: 'Deck is getting big', detail: `${ctx.profile.deckSize} cards — every add dilutes your draws`, value: v });
  }

  const best = results[0];
  if (best) {
    const pickRate = best.detail.base.row?.pickRateByAct?.[ctx.state.game.act - 1]
      ?? best.detail.base.row?.pickRate;
    if (pickRate != null) {
      const communitySkip = 100 - pickRate;
      const v = (communitySkip - 50) * 0.45;
      value += v;
      notes.push({
        label: 'Community behaviour',
        detail: `${communitySkip.toFixed(0)}% of players skip ${best.card.name} when it is offered in Act ${ctx.state.game.act}`,
        value: v,
      });
    }
    const v = -(best.total - 55) * 0.6;
    value += v;
    notes.push({
      label: `Best offer is ${best.card.name}`,
      detail: best.total >= 55 ? 'it fits this build well enough to be worth the slot' : 'nothing on offer really fits',
      value: v,
    });
  } else {
    notes.push({ label: 'No cards entered', detail: 'add the cards you were offered to compare against skipping', value: 0 });
  }

  notes.sort((a, b) => b.value - a.value);
  return { total: clamp(value), notes, isSkip: true, card: { name: 'Skip' }, contributions: notes.map((n) => ({ label: n.label, delta: n.value })) };
}

export function rankRewards(ctx) {
  const results = ctx.state.currentChoice.candidates
    .map((c) => scoreCandidate(c.cardId, c.upgraded, ctx))
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
  const skip = ctx.state.currentChoice.allowSkip ? scoreSkip(results, ctx) : null;
  return { results, skip };
}

/* --------------------------------------------------------- removal advisor */

function isStrikeOrDefend(card) {
  const tags = card.tags || [];
  return tags.includes('Strike') || tags.includes('Defend')
    || /^(STRIKE|DEFEND)_/.test(card.id);
}

/** Eternal cards cannot leave the deck, so they are never removal candidates. */
export function isEternal(card) {
  return (card.keywords_key || card.keywords || []).some((k) => String(k).toLowerCase() === 'eternal');
}

/**
 * Removal priority (plan §24). Higher means "cut this first".
 */
export function rankRemovals(ctx) {
  const out = [];

  for (const entry of ctx.player.deck) {
    const card = game.cards.get(entry.cardId);
    if (!card) continue;
    const copies = entry.normal + entry.upgraded;
    if (copies <= 0) continue;
    if (isEternal(card)) continue;

    const contributions = [];
    let score = 0;
    const add = (label, detail, value) => { if (Math.abs(value) >= 0.5) { contributions.push({ label, detail, value }); score += value; } };

    const rarity = card.rarity_key || card.rarity;

    if (rarity === 'Curse') {
      add('Curse', 'dead weight that actively hurts you', 46);
    }
    if (rarity === 'Status') {
      add('Status card', 'clogs your draws', 40);
    }

    // Statistical weakness, on a profile that excludes the card itself.
    const soloProfile = profileWithout(ctx.player, entry.cardId);
    const base = baseStrength(card, entry.upgraded > 0 && entry.normal === 0, ctx.cardMetrics, ctx.state.game.act);
    if (rarity !== 'Curse' && rarity !== 'Status' && rarity !== 'Basic') {
      const v = (50 - base.value) * 0.55;
      add('Low community value', base.samples
        ? `Codex Score ${base.row?.score ?? '—'} across ${fmt(base.samples)} observations`
        : 'no community data — judged by rarity', v);
    }

    // How much is it actually doing for *this* build?
    const syn = deckSynergy(card, soloProfile);
    const v2 = (50 - syn.value) * 0.5;
    add('Contribution to this build', syn.contributions.length
      ? `only touches ${syn.contributions.slice(0, 2).map((c) => c.label).join(' and ')}`
      : 'does not interact with anything else you have', v2);

    // Strikes and Defends are the classic cut. The signature starter (Bash,
    // Neutralize, Survivor, Zap...) is usually a keeper, so it gets a much
    // smaller prior.
    if (rarity === 'Basic') {
      const filler = isStrikeOrDefend(card);
      const planStrength = Math.max(...roleCoverage(ctx.profile).map((c) => c.pct));
      const v = filler ? 14 + Math.min(planStrength / 10, 10) : 4;
      add('Starter card', filler
        ? 'thinning Strikes and Defends is how the deck gets consistent'
        : 'a starter, but the signature one is usually worth keeping', v);
    }

    // Redundancy: the 4th Strike is worth less than the 1st.
    if (copies > 1) {
      const v = (copies - 1) * (isStrikeOrDefend(card) ? 5 : 3);
      add('Redundant copies', `${copies} copies in the deck`, v);
    }

    // Things that protect a card from the chopping block.
    const rel = relicSynergy(card, ctx.player);
    if (rel.value > 52) {
      const v = -(rel.value - 50) * 0.7;
      add('Relic interaction', `works with ${rel.contributions.slice(0, 2).map((c) => c.name).join(', ')}`, v);
    }
    const archetypeHits = [...card.traits].filter((t) => ARCHETYPE_TAGS.has(t) && (ctx.profile.traits.get(t) || 0) > 2);
    if (archetypeHits.length) {
      const v = -Math.min(archetypeHits.length * 7, 18);
      add('Core to your plan', `part of your ${archetypeHits.map(labelFor).join(' / ')} build`, v);
    }

    // Multiplayer: do not cut the card holding the party together (plan §25).
    if (ctx.state.game.mode === 'multiplayer' && (card.traits.has('ally-buff') || card.multiplayer_only)) {
      add('Party-critical', 'one of the few things you bring for the team', -12);
    }

    contributions.sort((a, b) => b.value - a.value);
    out.push({
      cardId: card.id, card, copies, entry,
      // Soft compression keeps 100 from swallowing the top of the list.
      total: clamp(50 + 50 * Math.tanh(score / 55)),
      contributions,
      confidence: confidenceOf(base, ctx, { context: 'none' }),
    });
  }

  return out.sort((a, b) => b.total - a.total);
}

/** Profile of the deck as if one copy of `cardId` were not in it. */
function profileWithout(player, cardId) {
  const clone = {
    ...player,
    deck: player.deck.map((d) => (d.cardId === cardId
      ? { ...d, normal: Math.max(0, d.normal - (d.normal > 0 ? 1 : 0)), upgraded: d.normal > 0 ? d.upgraded : Math.max(0, d.upgraded - 1) }
      : d)),
  };
  return buildProfile(clone);
}

export { fmt };
