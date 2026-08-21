/**
 * Mechanic tag extraction.
 *
 * The Spire Codex API exposes no pairwise card-synergy statistics, so synergy
 * here is *mechanistic*: we read what a card actually does out of its structured
 * fields and rules text, then match cards that produce an effect against cards
 * that consume it.
 *
 * Two namespaces:
 *   traits — what this card puts into the deck ("applies Poison", "is an Attack")
 *   wants  — what this card is paid off by ("scales with Poison", "triggers on Attacks")
 *
 * Synergy between a candidate and a deck is then
 *   candidate.wants x deck.traits   (deck already feeds the candidate)
 * + candidate.traits x deck.wants   (candidate feeds payoffs the deck already has)
 * + archetype concentration          (both push the same axis)
 */

/**
 * Buff powers that a card can either grant you or strip from an enemy.
 * "Gain 2 Strength" and "Enemy loses 9 Strength" mention the same word and mean
 * opposite things, so these get a polarity check rather than a bare text match.
 */
const BUFF_TAGS = ['strength', 'dexterity', 'focus', 'thorns', 'vigor', 'plating'];

/** Tags where piling up more copies is itself the point. */
export const ARCHETYPE_TAGS = new Set([
  'poison', 'shiv', 'orb', 'strength', 'dexterity', 'focus', 'block', 'exhaust',
  'discard', 'doom', 'summon', 'stars', 'thorns', 'multi-hit', 'aoe',
  'zero-cost', 'card-gen', 'ally-buff', 'retain', 'lightning', 'frost', 'dark',
]);

/** Human labels for explanation lines. */
export const TAG_LABELS = {
  attack: 'Attacks', skill: 'Skills', power: 'Powers', strike: 'Strike cards',
  'multi-hit': 'multi-hit attacks', aoe: 'AoE', block: 'Block', draw: 'card draw',
  energy: 'energy', discard: 'discard', exhaust: 'Exhaust', retain: 'Retain',
  ethereal: 'Ethereal', innate: 'Innate', 'zero-cost': '0-cost cards',
  'x-cost': 'X-cost cards', 'high-cost': 'expensive cards', strength: 'Strength',
  dexterity: 'Dexterity', focus: 'Focus', poison: 'Poison', shiv: 'Shivs',
  orb: 'Orbs', lightning: 'Lightning orbs', frost: 'Frost orbs', dark: 'Dark orbs',
  vulnerable: 'Vulnerable', weak: 'Weak', debuff: 'debuffs', summon: 'summons',
  doom: 'Doom', stars: 'Stars', heal: 'healing', 'hp-loss': 'HP loss',
  'curse-gen': 'Curses', 'status-gen': 'Status cards', 'card-gen': 'card generation',
  'cost-reduction': 'cost reduction', scaling: 'scaling', intangible: 'Intangible',
  thorns: 'Thorns', 'ally-buff': 'ally support', 'team-block': 'team Block',
  multiplayer: 'multiplayer effects', 'card-count': 'playing many cards',
  gold: 'gold', potion: 'potions', upgrade: 'upgrades',
};

export function labelFor(tag) {
  return TAG_LABELS[tag] || tag;
}

/**
 * Rules run against a lowercased blob of the card's rendered text, raw template
 * text and applied-power names, so both "Apply 2 Vulnerable" and the
 * "{VulnerablePower}" template form match.
 */
const TRAIT_RULES = [
  ['multi-hit', /(\d+|x)\s+times|twice|thrice|hit_count/],
  ['block', /\bblock\b/],
  ['draw', /\bdraw\b.{0,14}\bcard/],
  ['energy', /gain.{0,20}energy|energyicons|\benergy\b/],
  ['discard', /\bdiscard\b(?!\s+pile)/],
  ['exhaust', /\bexhaust/],
  ['strength', /\bstrength\b/],
  ['dexterity', /\bdexterity\b/],
  ['focus', /\bfocus\b/],
  ['poison', /\bpoison\b/],
  ['shiv', /\bshiv/],
  ['orb', /\borb\b|\bchannel\b|\bevoke\b/],
  ['lightning', /\blightning\b/],
  ['frost', /\bfrost\b/],
  ['dark', /\bdark\b/],
  ['vulnerable', /\bvulnerable\b/],
  ['weak', /\bweak\b/],
  ['thorns', /\bthorns\b/],
  ['intangible', /\bintangible\b/],
  ['summon', /\bsummon\b|\bosty\b|\bminion\b/],
  ['doom', /\bdoom\b/],
  ['stars', /\bstar\b|\bstars\b|staricons/],
  ['heal', /\bheal\b|\bheals\b/],
  ['hp-loss', /\blose\b.{0,10}\bhp\b|hp_loss/],
  ['curse-gen', /add.{0,30}curse|\bcurse\b.{0,20}(into|to your)/],
  ['status-gen', /\b(burn|wound|dazed|slimed|void)\b/],
  ['card-gen', /\badd\b.{0,40}(into|to) your|\bcreate\b|\bcopy of\b/],
  ['cost-reduction', /costs?\s+.{0,6}less|costs?\s+0/],
  ['gold', /\bgold\b/],
  ['potion', /\bpotion/],
  ['upgrade', /\bupgrade/],
  ['ally-buff', /\ball(y|ies)\b|other player/],
  ['multiplayer', /\bplayers?\b/],
];

/**
 * A "want" is a payoff trigger. Nearly all of them are phrased as a trigger
 * ("whenever you...") or a magnitude reference ("for each...", "equal to your...").
 */
const WANT_RULES = [
  ['attack', /whenever you play an attack|for each attack|attack is played/],
  ['skill', /whenever you play a skill|for each skill/],
  ['power', /whenever you play a power|for each power/],
  ['card-count', /whenever you play a card|for each card played|cards played this turn/],
  ['exhaust', /whenever you exhaust|for each card exhausted|cards exhausted/],
  ['discard', /whenever you discard|for each card discarded|cards discarded/],
  ['strength', /for each.{0,12}strength|equal to your strength|strength is (gained|applied)/],
  ['poison', /for each.{0,12}poison|poison is triggered|poisoned enem/],
  ['shiv', /shivs deal|for each shiv|whenever you play a shiv/],
  ['orb', /for each.{0,12}orb|orb slot|your orbs|each of your orbs/],
  ['focus', /for each.{0,12}focus|equal to your focus/],
  ['block', /for each.{0,12}block|equal to your block|unspent block/],
  ['doom', /for each.{0,12}doom|doomed/],
  ['stars', /for each.{0,12}star|spend.{0,12}star/],
  ['summon', /for each.{0,12}(summon|minion)|your minions|osty's/],
  ['draw', /for each card drawn|whenever you draw/],
  ['hp-loss', /whenever you lose hp|for each.{0,12}hp lost/],
  ['curse-gen', /whenever you (draw|play).{0,12}curse|for each curse/],
  ['status-gen', /whenever you (draw|play).{0,12}status|for each status/],
  ['gold', /for each.{0,12}gold|equal to your gold/],
  ['vulnerable', /vulnerable enem|enemies are vulnerable/],
  ['weak', /weakened enem|enemies are weak/],
  ['ally-buff', /whenever an ally|for each ally|each other player/],
];

/**
 * If a card has trait A, it is implicitly paid off by B (and vice versa).
 * Keeps the rule tables small without an NxN hand-tuned matrix.
 */
const CROSS_WANTS = {
  'multi-hit': ['strength'],
  strike: ['strength'],
  shiv: ['strength'],
  block: ['dexterity'],
  dexterity: ['block'],
  strength: ['multi-hit', 'attack'],
  orb: ['focus'],
  focus: ['orb'],
  lightning: ['focus'], frost: ['focus'], dark: ['focus'],
  'curse-gen': ['exhaust'],
  'status-gen': ['exhaust'],
  exhaust: ['curse-gen', 'status-gen'],
  'x-cost': ['energy', 'cost-reduction'],
  'high-cost': ['energy', 'cost-reduction'],
  'zero-cost': ['card-count'],
  'card-gen': ['card-count'],
  'card-count': ['zero-cost', 'card-gen', 'cost-reduction'],
  draw: ['zero-cost'],
  summon: ['summon'],
  doom: ['doom'],
  poison: ['poison'],
  stars: ['stars'],
  thorns: ['block'],
  'ally-buff': ['multiplayer'],
};

/** `[gold]`/`[blue]` colour markup would otherwise match rules like /\bgold\b/. */
function stripMarkup(s) {
  return String(s || '').replace(/\[\/?[a-z]+\]/gi, ' ');
}

function textBlob(e) {
  const parts = [
    e.name || '', stripMarkup(e.description), stripMarkup(e.description_raw),
    ...(e.keywords || []), ...(e.tags || []),
    ...((e.powers_applied || []).map((p) => p.power)),
  ];
  return parts.join(' \n ').toLowerCase();
}

/**
 * @param {object} e   raw card or relic from the API
 * @param {'card'|'relic'} kind
 * @returns {{traits:Set<string>, wants:Set<string>, roles:object}}
 */
export function extractTags(e, kind = 'card') {
  const blob = textBlob(e);
  const traits = new Set();
  const wants = new Set();

  for (const [tag, re] of TRAIT_RULES) if (re.test(blob)) traits.add(tag);
  for (const [tag, re] of WANT_RULES) if (re.test(blob)) wants.add(tag);

  if (kind === 'card') {
    const type = (e.type_key || e.type || '').toLowerCase();
    if (type === 'attack') traits.add('attack');
    if (type === 'skill') traits.add('skill');
    if (type === 'power') { traits.add('power'); traits.add('scaling'); }
    if (type === 'curse') traits.add('curse-gen');
    if (type === 'status') traits.add('status-gen');

    if ((e.tags || []).includes('Strike') || /\bstrike\b/i.test(e.name || '')) traits.add('strike');
    if ((e.hit_count || 0) > 1) traits.add('multi-hit');
    if (e.target === 'AllEnemies') traits.add('aoe');
    if (e.target === 'AnyAlly' || e.target === 'AllAllies') { traits.add('ally-buff'); traits.add('multiplayer'); }
    if (e.block) traits.add('block');
    if (e.cards_draw) traits.add('draw');
    if (e.energy_gain) traits.add('energy');
    if (e.hp_loss) traits.add('hp-loss');
    if (e.is_x_cost || e.is_x_star_cost) traits.add('x-cost');
    if (e.cost === 0) traits.add('zero-cost');
    if (typeof e.cost === 'number' && e.cost >= 3) traits.add('high-cost');
    if (e.multiplayer_only) traits.add('multiplayer');
    if ((e.spawns_cards || []).length && /\b(add|create|shuffle|place|put)\b/.test(blob)) traits.add('card-gen');

    for (const kw of e.keywords_key || e.keywords || []) {
      const k = String(kw).toLowerCase();
      if (k === 'exhaust') traits.add('exhaust');
      if (k === 'retain') traits.add('retain');
      if (k === 'ethereal') traits.add('ethereal');
      if (k === 'innate') traits.add('innate');
    }

    // Powers applied to self that grow over the fight are the scaling engine.
    for (const p of e.powers_applied || []) {
      const n = String(p.power || '').toLowerCase();
      if (['vulnerable', 'weak', 'frail', 'poison'].includes(n)) traits.add('debuff');
    }
  } else {
    // Relics have no structured mechanics, only rules text.
    if (/\bstart of (each )?combat\b|\bat the start\b/.test(blob)) traits.add('front-load');
    if (/upon pickup/.test(blob)) traits.add('one-shot');
  }

  applyBuffPolarity(e, blob, traits);

  for (const t of [...traits]) for (const w of CROSS_WANTS[t] || []) wants.add(w);

  return { traits, wants, roles: roleProfile(e, kind, traits) };
}

/**
 * Keeps a buff tag only when the card actually grants it. Cards that strip the
 * buff from an enemy ("Enemy loses 9 Strength") become debuffs instead, and
 * cards that cost you the buff ("lose 1 Dexterity") lose the tag entirely.
 */
function applyBuffPolarity(e, blob, traits) {
  for (const tag of BUFF_TAGS) {
    if (!traits.has(tag)) continue;

    const gains = new RegExp(`gains?\\b[^.]{0,40}\\b${tag}\\b`).test(blob);
    const loses = new RegExp(`lose[sd]?\\b[^.]{0,30}\\b${tag}\\b`).test(blob);
    const stripsEnemy = new RegExp(`(enem\\w+|it)\\s+lose[sd]?\\b[^.]{0,30}\\b${tag}\\b`).test(blob);

    // `powers_applied` stores magnitude without sign — Friendship records
    // `amount: 2` for a card that *loses* 2 Strength — so it is only trusted
    // when the text commits to neither direction.
    const grants = gains || (!loses && e.target === 'Self'
      && (e.powers_applied || []).some((p) => String(p.power).toLowerCase() === tag));

    if (stripsEnemy) traits.add('debuff');
    if (!grants) traits.delete(tag);
  }

  // Scaling comes from a buff that survived the polarity check, not from the
  // mere mention of one.
  if (BUFF_TAGS.some((t) => traits.has(t))) traits.add('scaling');
}

/**
 * Coarse "what job does this do" numbers, used for build gap analysis
 * (the Build Profile panel) rather than for pairwise synergy.
 */
function roleProfile(e, kind, traits) {
  const r = { damage: 0, aoe: 0, defense: 0, scaling: 0, draw: 0, energy: 0, debuff: 0, sustain: 0 };
  if (kind === 'card') {
    const hits = Math.max(1, e.hit_count || 1);
    if (e.damage) r.damage = e.damage * hits;
    if (e.block) r.defense = e.block;
    if (e.cards_draw) r.draw = e.cards_draw;
    if (e.energy_gain) r.energy = e.energy_gain * 3;
    if (traits.has('aoe')) r.aoe = (e.damage || 4) * hits;
    if (traits.has('scaling')) r.scaling = 8;
    if (traits.has('debuff')) r.debuff = 5;
    if (traits.has('heal')) r.sustain = 5;
    if (e.is_x_cost) { r.damage = Math.max(r.damage, 12); r.scaling += 4; }
  } else {
    if (traits.has('block')) r.defense = 6;
    if (traits.has('draw')) r.draw = 1;
    if (traits.has('energy')) r.energy = 6;
    if (traits.has('strength') || traits.has('focus') || traits.has('dexterity')) r.scaling = 8;
    if (traits.has('heal')) r.sustain = 6;
  }
  return r;
}
