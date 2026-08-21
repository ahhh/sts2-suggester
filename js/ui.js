/**
 * Rendering and interaction.
 *
 * Plain DOM with event delegation — no framework, no build step (plan §29).
 * Every interactive control carries a `data-act`, and one document-level
 * listener dispatches them.
 */

import * as S from './state.js';
import * as Score from './scoring.js';
import { game, dataStatus, BRACKETS, defaultBracket } from './data.js';
import { cardPool, relicPool, imageUrl, search } from './album.js';
import { labelFor } from './tags.js';

/* ------------------------------------------------------------------ helpers */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The API marks up rules text with `[gold]...[/gold]`. Keep the emphasis. */
const KW_COLOR = { gold: 'var(--gold)', blue: 'var(--t-skill)', red: 'var(--blood)', pink: 'var(--r-ancient)' };
function rich(text) {
  return esc(text || '')
    .replace(/\[(\/?)([a-z]+)\]/gi, (m, close, name) => {
      const c = KW_COLOR[name.toLowerCase()];
      if (!c) return '';
      return close ? '</span>' : `<span style="color:${c}">`;
    })
    .replace(/\n/g, '<br>');
}
const plain = (text) => String(text || '').replace(/\[\/?[a-z]+\]/gi, '').replace(/\n/g, ' ').trim();

const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

/** Which half of the duotone a contribution belongs to. */
const KIND = { base: 'evidence', upgrade: 'evidence', deckSynergy: 'fit', relicSynergy: 'fit', duplicate: 'fit', context: 'fit', party: 'fit' };
const kindOf = (c) => (c.delta < 0 ? 'negative' : KIND[c.key] || 'fit');

let toastTimer = null;
export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.setAttribute('role', 'status');
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

/* --------------------------------------------------------------- app state */

/** Metrics table for the currently selected bracket. Swapped when it changes. */
export const view = {
  cardMetrics: null,
  relicMetrics: null,
  bracket: null,
  ranked: null,       // last computed {results, skip}
  removals: null,
  loadingMetrics: false,
};

function ctx() {
  const player = S.primary();
  return {
    state: S.state,
    player,
    profile: Score.buildProfile(player),
    cardMetrics: view.cardMetrics,
    relicMetrics: view.relicMetrics,
  };
}

/* ------------------------------------------------------------------ render */

export function renderAll() {
  const needsSetup = !S.primary()?.character;
  $('#setup').hidden = !needsSetup;
  $('#board').style.display = needsSetup ? 'none' : '';
  document.querySelector('.site-foot').style.display = needsSetup ? 'none' : '';

  renderTopbar();
  if (needsSetup) { renderSetup(); return; }

  renderRunPanel();
  renderBuildPanel();
  renderAdvisorPanel();
  renderFootData();
}

/* --------------------------------------------------------------- new run */

/** The new-run form's draft lives on window so app.js can read it back. */
function draft() {
  window.__setupDraft ??= { character: null, mode: 'singleplayer', ascension: 0, partySize: 2 };
  return window.__setupDraft;
}

function renderSetup() {
  const chars = [...game.characters.values()];
  const setupDraft = draft();

  $('#setup-inner').innerHTML = `
    <h1>Rank the pick against <em>the deck you actually have</em>.</h1>
    <p class="lede">Enter your run once, then keep this page open. Every reward takes three clicks:
      pick the cards you were offered, read the ranking, tell it what you took.</p>

    <div class="block">
      <h3>Run mode</h3>
      <div class="tabs" style="max-width:340px">
        ${['singleplayer', 'multiplayer', 'daily'].map((m) => `
          <button class="tab" role="tab" data-act="setup-mode" data-mode="${m}" aria-selected="${setupDraft.mode === m}">
            ${m === 'singleplayer' ? 'Solo' : m === 'multiplayer' ? 'Co-op' : 'Daily'}
          </button>`).join('')}
      </div>
    </div>

    ${setupDraft.mode === 'multiplayer' ? `
      <div class="block">
        <h3>Party size</h3>
        <div class="tabs" style="max-width:220px">
          ${[2, 3, 4].map((n) => `<button class="tab" role="tab" data-act="setup-party" data-n="${n}" aria-selected="${setupDraft.partySize === n}">${n} players</button>`).join('')}
        </div>
      </div>` : ''}

    <div class="block">
      <h3>Your character</h3>
      <div class="charpick">
        ${chars.map((c) => {
          const art = `https://cdn.spire-codex.com/characters/combat_${String(c.id).toLowerCase()}.webp`;
          return `<button class="charcard" data-act="setup-char" data-id="${c.id}" aria-pressed="${setupDraft.character === c.id}">
            <div class="charcard-art" style="background-image:url('${art}')"></div>
            <div class="charcard-name">${esc(c.name.replace(/^The /, ''))}</div>
            <div class="charcard-hp">${c.starting_hp} HP · ${(c.starting_deck || []).length} cards</div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <div class="setup-row">
      <div class="field" style="width:150px">
        <label for="setup-asc">Ascension</label>
        <select class="select" id="setup-asc" data-act="setup-asc">
          ${Array.from({ length: S.MAX_ASCENSION + 1 }, (_, i) => `<option value="${i}" ${setupDraft.ascension === i ? 'selected' : ''}>A${i}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn--primary" data-act="setup-start" ${setupDraft.character ? '' : 'disabled'}>
        Start run${setupDraft.character ? ` as ${esc(game.characters.get(setupDraft.character).name.replace(/^The /, ''))}` : ''}
      </button>
      <button class="btn btn--ghost" data-act="import-run">Load a saved run</button>
    </div>

    <p class="muted" style="margin-top:18px;font-size:13px;max-width:60ch">
      Your starting deck, starter relic and HP are filled in automatically${setupDraft.ascension >= S.ASCENDERS_BANE_LEVEL ? ", including Ascender's Bane at A5+" : ''} —
      you only enter what has changed since floor 1.
    </p>`;
}

/* ------------------------------------------------------------------ topbar */

function renderTopbar() {
  const p = S.primary();
  const g = S.state.game;
  const line = $('#runline');

  if (!p?.character) {
    line.innerHTML = '';
    $('#topbar-actions').innerHTML = sourceBadge();
    return;
  }

  const ch = game.characters.get(p.character);
  const modeLabel = g.mode === 'multiplayer' ? `${S.state.players.length}-player co-op` : g.mode === 'daily' ? 'Daily' : 'Solo';
  line.innerHTML = `
    <span class="chip">${esc(ch?.name.replace(/^The /, '') || p.character)}</span>
    <span class="chip num">A${g.ascension}</span>
    <span class="chip num">Act ${g.act} · Floor ${g.floor}</span>
    <span class="chip">${modeLabel}</span>
    ${p.hp != null ? `<span class="chip num" style="color:${p.hp / (p.maxHp || 1) < 0.35 ? 'var(--blood)' : 'inherit'}">${p.hp}/${p.maxHp} HP</span>` : ''}
    <span class="chip num">${S.deckSize(p)} cards</span>`;

  $('#topbar-actions').innerHTML = `
    ${sourceBadge()}
    <button class="btn btn--sm" data-act="next-floor">Next floor</button>
    <button class="btn btn--sm btn--ghost" data-act="export-run">Export</button>
    <button class="btn btn--sm btn--ghost btn--danger" data-act="new-run">New run</button>`;
}

function sourceBadge() {
  const s = dataStatus;
  const when = s.fetchedAt ? new Date(s.fetchedAt).toLocaleString() : 'unknown';
  const label = { live: 'Live data', cache: 'Cached data', offline: 'Offline snapshot', loading: 'Loading' }[s.source] || s.source;
  const title = s.note || `Spire Codex data, retrieved ${when}.`;
  return `<span class="source" data-source="${s.source}" title="${esc(title)}">${label}</span>`;
}

function renderFootData() {
  const t = view.cardMetrics;
  if (!t) return;
  const b = BRACKETS.find((x) => x.id === view.bracket);
  $('#foot-data').textContent =
    `Statistics: ${b?.label ?? view.bracket} · ${t.totalRuns.toLocaleString()} runs · baseline win rate ${t.baselineWinRate}%`;
}

/* -------------------------------------------------------------- run panel */

function renderRunPanel() {
  const p = S.primary();
  const g = S.state.game;
  const mp = g.mode === 'multiplayer';

  $('#panel-run').innerHTML = `
    <h2 class="panel-title">Run</h2>

    <div class="block">
      <div class="tabs">
        ${['singleplayer', 'multiplayer', 'daily'].map((m) => `
          <button class="tab" role="tab" data-act="set-mode" data-mode="${m}" aria-selected="${g.mode === m}">
            ${m === 'singleplayer' ? 'Solo' : m === 'multiplayer' ? 'Co-op' : 'Daily'}
          </button>`).join('')}
      </div>
    </div>

    <div class="block grid2">
      <div class="field">
        <label for="f-asc">Ascension</label>
        <select class="select num" id="f-asc" data-act="set-asc">
          ${Array.from({ length: S.MAX_ASCENSION + 1 }, (_, i) => `<option value="${i}" ${g.ascension === i ? 'selected' : ''}>A${i}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-act">Act</label>
        <select class="select num" id="f-act" data-act="set-act">
          ${[1, 2, 3, 4].map((a) => `<option value="${a}" ${g.act === a ? 'selected' : ''}>Act ${a}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-floor">Floor</label>
        <input class="input num" id="f-floor" type="number" min="0" max="99" value="${g.floor}" data-act="set-floor">
      </div>
      <div class="field">
        <label for="f-gold">Gold</label>
        <input class="input num" id="f-gold" type="number" min="0" value="${p.gold ?? ''}" data-act="set-gold">
      </div>
      <div class="field">
        <label for="f-hp">HP</label>
        <input class="input num" id="f-hp" type="number" min="0" value="${p.hp ?? ''}" data-act="set-hp">
      </div>
      <div class="field">
        <label for="f-maxhp">Max HP</label>
        <input class="input num" id="f-maxhp" type="number" min="1" value="${p.maxHp ?? ''}" data-act="set-maxhp">
      </div>
    </div>

    ${mp ? renderParty() : ''}

    <div class="block">
      <h3>Statistics</h3>
      <select class="select" data-act="set-bracket" aria-label="Statistical bracket">
        <option value="">Follow the run (${BRACKETS.find((b) => b.id === defaultBracket(S.state))?.label})</option>
        ${BRACKETS.map((b) => `<option value="${b.id}" ${S.state.preferences.bracket === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}
      </select>
      <p class="muted" style="font-size:11.5px;margin:6px 0 0">
        ${esc(BRACKETS.find((b) => b.id === view.bracket)?.hint || '')}
        Thin slices widen to all runs automatically, and say so.
      </p>
    </div>

    <div class="block">
      <h3>Starting state</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn--sm" data-act="reset-starter">Reset to character start</button>
        <button class="btn btn--sm btn--ghost" data-act="start-empty">Empty the build</button>
      </div>
    </div>

    <div class="block">
      <h3>Your data</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn--sm btn--ghost" data-act="import-run">Import run</button>
        <button class="btn btn--sm btn--ghost btn--danger" data-act="clear-data">Clear local data</button>
      </div>
    </div>`;
}

function renderParty() {
  const players = S.state.players;
  return `
    <div class="block">
      <h3>Party <span class="eyebrow">★ = being advised</span></h3>
      <div class="tabs" style="margin-bottom:8px">
        ${[2, 3, 4].map((n) => `<button class="tab" role="tab" data-act="set-party" data-n="${n}" aria-selected="${players.length === n}">${n}</button>`).join('')}
      </div>
      <div class="party">
        ${players.map((pl) => {
          const ch = pl.character ? game.characters.get(pl.character) : null;
          const isPrimary = pl.id === S.state.primaryPlayerId;
          const known = pl.deck.length ? `${S.deckSize(pl)} cards` : pl.roleTags?.length ? pl.roleTags.join(', ') : 'nothing entered';
          return `
            <button class="party-tab" data-act="set-primary" data-id="${pl.id}" aria-pressed="${isPrimary}">
              ${isPrimary ? '<span class="party-star">★</span>' : '<span style="width:9px"></span>'}
              <span style="flex:1;min-width:0">
                <span>${esc(pl.label)}</span>
                <span class="muted"> — ${esc(ch?.name.replace(/^The /, '') || 'no character')}</span>
                <span class="muted" style="display:block">${esc(known)}</span>
              </span>
            </button>
            ${isPrimary ? '' : `<div style="display:flex;gap:5px;padding:0 0 4px 22px;flex-wrap:wrap">
              <select class="select" style="width:auto;flex:1;min-width:110px" data-act="set-mate-char" data-id="${pl.id}">
                <option value="">Character…</option>
                ${[...game.characters.values()].map((c) => `<option value="${c.id}" ${pl.character === c.id ? 'selected' : ''}>${esc(c.name.replace(/^The /, ''))}</option>`).join('')}
              </select>
              ${S.PARTY_ROLES.map((r) => `<button class="filter" data-act="toggle-role" data-id="${pl.id}" data-role="${r}" aria-pressed="${pl.roleTags?.includes(r)}">${r}</button>`).join('')}
            </div>`}`;
        }).join('')}
      </div>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">
        Teammates are optional. Characters alone already help; roles help more; entering their decks helps most.
      </p>
    </div>`;
}

/* ------------------------------------------------------------ build panel */

function renderBuildPanel() {
  const p = S.primary();
  const profile = Score.buildProfile(p);
  const sorted = p.deck.slice().sort(deckOrder);

  $('#panel-build').innerHTML = `
    <h2 class="panel-title">
      <span>Your build</span>
      <span class="num">${S.deckSize(p)} cards · ${p.relics.length} relics</span>
    </h2>

    <div class="block">
      <h3>
        Deck
        <span style="display:flex;gap:5px">
          <button class="btn btn--sm btn--primary" data-act="add-card">+ Add card</button>
        </span>
      </h3>
      <div class="decklist">
        ${sorted.length ? sorted.map(deckRow).join('')
          : '<p class="empty">No cards yet. Add what you are holding, or reset to the character starter deck.</p>'}
      </div>
    </div>

    <div class="block">
      <h3>
        Relics
        <button class="btn btn--sm" data-act="add-relic">+ Add relic</button>
      </h3>
      <div class="relics">
        ${p.relics.length ? p.relics.map(relicChip).join('')
          : '<p class="empty">No relics yet.</p>'}
      </div>
    </div>

    <div class="block">
      <h3>Build profile</h3>
      <div class="roles">
        ${Score.roleCoverage(profile).map((r) => `
          <div class="role">
            <span>${r.label}</span>
            <span class="role-track"><span class="role-fill" data-status="${r.status}" style="width:${Math.min(r.pct / 1.4, 100).toFixed(1)}%"></span></span>
            <span class="role-status">${r.status}</span>
          </div>`).join('')}
      </div>
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">
        Measured per card, so it does not simply reward a bigger deck. The line marks what a functional deck tends to reach.
      </p>
    </div>

    ${archetypeLine(profile)}`;
}

function deckOrder(a, b) {
  const ca = game.cards.get(a.cardId); const cb = game.cards.get(b.cardId);
  if (!ca || !cb) return 0;
  const rank = (c) => ({ Curse: 0, Status: 1, Basic: 2 }[c.rarity_key || c.rarity] ?? 3);
  return rank(ca) - rank(cb) || (ca.type || '').localeCompare(cb.type || '') || ca.name.localeCompare(cb.name);
}

function deckRow(entry) {
  const c = game.cards.get(entry.cardId);
  if (!c) return '';
  const type = c.type_key || c.type;
  const cost = c.cost === -1 ? 'X' : c.cost ?? '—';
  const qty = entry.normal + entry.upgraded;
  return `
    <div class="deckrow ${entry.upgraded ? 'deckrow--upgraded' : ''}" title="${esc(plain(c.description))}">
      <span class="spine" data-type="${type}"></span>
      <span class="cost num">${cost}</span>
      <span class="deckrow-name">${esc(c.name)}${entry.upgraded ? ` <span class="up">+${entry.upgraded}</span>` : ''}</span>
      <span class="deckrow-qty">×${qty}</span>
      <span class="deckrow-tools">
        <button class="btn btn--sm btn--ghost" data-act="card-upgrade" data-id="${c.id}" title="Upgrade a copy" ${entry.normal ? '' : 'disabled'}>↑</button>
        <button class="btn btn--sm btn--ghost" data-act="card-downgrade" data-id="${c.id}" title="Un-upgrade a copy" ${entry.upgraded ? '' : 'disabled'}>↓</button>
        <button class="btn btn--sm btn--ghost" data-act="card-add" data-id="${c.id}" title="Add a copy">+</button>
        <button class="btn btn--sm btn--ghost btn--danger" data-act="card-remove" data-id="${c.id}" title="Remove a copy">−</button>
      </span>
    </div>`;
}

function relicChip(id) {
  const r = game.relics.get(id);
  if (!r) return '';
  const img = imageUrl(r);
  return `<button class="relic-chip" data-act="relic-remove" data-id="${id}" title="${esc(plain(r.description))} — click to remove">
    ${img ? `<img src="${img}" alt="" loading="lazy">` : ''}${esc(r.name)}<span class="x">×</span></button>`;
}

/** Names the two or three mechanics the deck is actually built around. */
function archetypeLine(profile) {
  const top = [...profile.traits]
    .filter(([t, w]) => w >= 2 && !['attack', 'skill', 'power', 'high-cost'].includes(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  if (!top.length) return '';
  return `
    <div class="block">
      <h3>What this deck does</h3>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${top.map(([t, w]) => `<span class="chip" title="${esc((profile.traitSources.get(t) || []).join(', '))}">
          ${esc(labelFor(t))} <b class="num" style="color:var(--ember)">${w.toFixed(1)}</b></span>`).join('')}
      </div>
    </div>`;
}

/* ---------------------------------------------------------- advisor panel */

function renderAdvisorPanel() {
  const c = S.state.currentChoice;
  const cands = c.candidates;

  $('#panel-advisor').innerHTML = `
    <h2 class="panel-title"><span>Advisor</span></h2>

    <div class="block">
      <h3>
        What were you offered?
        ${cands.length ? '<button class="btn btn--sm btn--ghost" data-act="clear-cands">Clear</button>' : ''}
      </h3>
      <div class="slots">
        ${cands.map((cand, i) => candidateSlot(cand, i)).join('')}
        ${cands.length < 6 ? `<button class="slot" data-act="add-candidate">
            <span style="width:34px;text-align:center;font-size:19px;line-height:1">+</span>
            <span class="slot-body"><span class="slot-name">Add a card you were offered</span>
            <span class="slot-meta">${cands.length ? 'or rank what you have' : 'usually three of them'}</span></span>
          </button>` : ''}
      </div>
      <label class="chip" style="margin-top:9px;cursor:pointer">
        <input type="checkbox" data-act="toggle-skip" ${c.allowSkip ? 'checked' : ''}> Include Skip as an option
      </label>
    </div>

    ${view.ranked ? renderRanking() : cands.length ? `
      <div class="block"><button class="btn btn--primary" style="width:100%" data-act="rank">Rank these ${cands.length} choices</button></div>`
      : '<p class="empty">Nothing entered yet. Add the cards you were offered and this will rank them against your deck.</p>'}

    ${renderRemovals()}`;
}

function candidateSlot(cand, i) {
  const card = game.cards.get(cand.cardId);
  if (!card) return '';
  const img = imageUrl(card);
  return `
    <div class="slot slot--filled">
      ${img ? `<img src="${img}" alt="" loading="lazy">` : ''}
      <span class="slot-body">
        <span class="slot-name">${esc(card.name)}${cand.upgraded ? '<span class="up" style="color:var(--gold)">+</span>' : ''}</span>
        <span class="slot-meta">${esc(card.type)} · ${esc(card.rarity)} · ${card.cost === -1 ? 'X' : card.cost} energy</span>
      </span>
      <button class="btn btn--sm btn--ghost" data-act="toggle-cand-upgrade" data-i="${i}" title="Toggle upgraded">${cand.upgraded ? '+' : '↑'}</button>
      <button class="btn btn--sm btn--ghost btn--danger" data-act="remove-candidate" data-i="${i}">×</button>
    </div>`;
}

function renderRanking() {
  const { results, skip } = view.ranked;
  const all = skip ? [...results, skip].sort((a, b) => b.total - a.total) : results;

  return `
    <div class="block">
      <h3>Ranking <button class="btn btn--sm btn--ghost" data-act="rank">Re-rank</button></h3>
      <div class="legend">
        <span><i data-kind="evidence"></i>measured — community runs</span>
        <span><i data-kind="fit"></i>inferred — fit to your deck</span>
      </div>
      ${all.map((r, i) => (r.isSkip ? skipCard(r, i, all.length) : resultCard(r, i))).join('')}
    </div>`;
}

/** Splits the 0-100 score into stacked segments either side of the neutral tick. */
function scoreBar(contributions) {
  const pos = contributions.filter((c) => c.delta > 0).sort((a, b) => (KIND[a.key] === 'evidence' ? -1 : 1));
  const neg = contributions.filter((c) => c.delta < 0);
  let left = 50;
  const posHtml = pos.map((c) => {
    const w = Math.min(c.delta, 100 - left);
    const h = `<span class="bar-seg" data-kind="${kindOf(c)}" style="left:${left}%;width:${Math.max(w, 0)}%"></span>`;
    left += w;
    return h;
  }).join('');
  let right = 50;
  const negHtml = neg.map((c) => {
    const w = Math.min(-c.delta, right);
    right -= w;
    return `<span class="bar-seg" data-kind="negative" style="left:${right}%;width:${w}%"></span>`;
  }).join('');
  return `<div class="bar">${negHtml}${posHtml}<span class="bar-tick" style="left:50%"></span></div>`;
}

function resultCard(r, i) {
  const img = imageUrl(r.card);
  const top = i === 0;
  return `
    <article class="result ${top ? 'result--top' : ''}">
      <div class="result-head">
        <span class="result-rank num">${i + 1}</span>
        <span class="result-name">
          ${img ? `<img src="${img}" alt="" loading="lazy" style="width:26px;height:26px;object-fit:cover;object-position:center 22%;border-radius:2px">` : ''}
          <span>${esc(r.card.name)}${r.upgraded ? '<b style="color:var(--gold)">+</b>' : ''}</span>
        </span>
        <span class="result-score num">${Math.round(r.total)}</span>
      </div>
      <p class="tagline">${esc(tagline(r))}</p>
      ${scoreBar(r.contributions)}
      <div class="result-foot">
        <span class="conf" data-level="${r.confidence.level}" title="${esc(r.confidence.reasons.join(' · '))}">${r.confidence.level} confidence</span>
        <span style="display:flex;gap:5px">
          <button class="btn btn--sm btn--ghost" data-act="cand-to-deck" data-id="${r.cardId}" data-up="${r.upgraded}">Add without clearing</button>
          <button class="btn btn--sm ${top ? 'btn--primary' : ''}" data-act="took" data-i="${i}" data-id="${r.cardId}" data-up="${r.upgraded}">I picked this</button>
        </span>
      </div>
      ${whyPanel(r)}
    </article>`;
}

function skipCard(r, i, n) {
  return `
    <article class="result result--skip ${i === 0 ? 'result--top' : ''}">
      <div class="result-head">
        <span class="result-rank num">${i + 1}</span>
        <span class="result-name"><span>Skip</span></span>
        <span class="result-score num">${Math.round(r.total)}</span>
      </div>
      <p class="tagline">${i === 0 ? 'Take nothing. Your deck is better off without any of these.' : 'Taking a card beats skipping here.'}</p>
      ${scoreBar(r.contributions.map((c) => ({ ...c, key: 'context' })))}
      <div class="result-foot">
        <span class="muted" style="font-size:11.5px">Skip is scored against the same 0–100 scale.</span>
        <button class="btn btn--sm ${i === 0 ? 'btn--primary' : ''}" data-act="took-skip">I skipped</button>
      </div>
      <details class="why">
        <summary><span>Why</span><span>▾</span></summary>
        <div class="why-body"><div class="ledger">
          ${r.notes.map((nt) => `
            <div class="ledger-row" data-kind="${nt.value >= 0 ? 'evidence' : 'negative'}">
              <i></i>
              <span><span class="ledger-label">${esc(nt.label)}</span><span class="ledger-note">${esc(nt.detail)}</span></span>
              <span class="ledger-delta" data-sign="${nt.value >= 0 ? 'pos' : 'neg'}">${signed(nt.value)}</span>
            </div>`).join('')}
        </div></div>
      </details>
    </article>`;
}

/** One plain sentence about why this card ranks where it does. */
function tagline(r) {
  const syn = r.detail.synergy.contributions;
  const bits = [];
  if (syn.length) {
    const names = syn.slice(0, 2).map((s) => s.label).join(' and ');
    bits.push(syn[0].kind === 'payoff' ? `Paid off by your ${names}` : `Feeds your ${names}`);
  }
  const base = r.detail.base;
  if (base.basis === 'community statistics' && base.row?.tier) {
    bits.push(`${base.row.tier}-tier across ${Score.fmt(base.samples)} runs`);
  } else if (base.basis === 'starter card') {
    bits.push('a starter card — no meaningful community read');
  } else if (!base.samples) {
    bits.push('no community data yet, judged on rarity and mechanics');
  }
  const dup = r.detail.dup;
  if (dup.note) bits.push(dup.note);
  return bits.length ? `${bits.join('. ')}.` : 'Nothing in your build interacts with this yet.';
}

function whyPanel(r) {
  const d = r.detail;
  const rows = r.contributions.map((c) => {
    let note = '';
    if (c.key === 'deckSynergy') {
      note = d.synergy.contributions.length
        ? d.synergy.contributions.slice(0, 4).map((h) => `${h.label}${h.sources.length ? ` (${h.sources.slice(0, 2).join(', ')})` : ''}`).join(' · ')
        : 'nothing in the deck interacts with it';
    } else if (c.key === 'relicSynergy') {
      note = d.relics.contributions.length
        ? d.relics.contributions.map((h) => `${h.name} ${signed(h.value)}`).join(' · ')
        : 'no relic interactions';
    } else if (c.key === 'context') {
      note = d.context.notes.length ? d.context.notes.map((n) => n.detail).join(' · ') : 'nothing act- or size-specific';
    } else if (c.key === 'base') {
      note = d.base.detail.map((x) => `${x.label} ${x.value}${x.note ? ` (${x.note})` : ''}`).join(' · ') || d.base.basis;
    } else if (c.key === 'duplicate') {
      note = d.dup.note || '';
    } else if (c.key === 'upgrade') {
      note = d.upg.note || '';
    } else if (c.key === 'party') {
      note = d.party.contributions.map((x) => `${x.label}: ${x.detail}`).join(' · ');
    }
    return `
      <div class="ledger-row" data-kind="${kindOf(c)}">
        <i></i>
        <span><span class="ledger-label">${esc(c.label)}</span>${note ? `<span class="ledger-note">${esc(note)}</span>` : ''}</span>
        <span class="ledger-delta" data-sign="${c.delta >= 0 ? 'pos' : 'neg'}">${signed(c.delta)}</span>
      </div>`;
  }).join('');

  const b = d.base;
  const strip = [
    b.samples ? `<span>Observations <b>${Score.fmt(b.samples)}</b></span>` : '<span>No community observations</span>',
    `<span>Bracket <b>${esc(b.bracket)}</b>${b.fellBack ? ' <em style="color:var(--gold)">(widened)</em>' : ''}</span>`,
    b.row?.winRate != null ? `<span>Win rate <b>${b.row.winRate.toFixed(1)}%</b> vs <b>${b.baseline ?? view.cardMetrics.baselineWinRate}%</b></span>` : '',
    b.row?.tier ? `<span>Tier <b>${b.row.tier}</b></span>` : '',
  ].filter(Boolean).join('');

  return `
    <details class="why">
      <summary><span>Why — full breakdown</span><span>▾</span></summary>
      <div class="why-body">
        <div class="ledger">
          <div class="ledger-row" style="border-bottom-color:var(--stone-line)">
            <i></i><span class="ledger-label">Neutral baseline</span><span class="ledger-delta num">50.0</span>
          </div>
          ${rows}
          <div class="ledger-row" style="border-bottom:0">
            <i></i><span class="ledger-label"><b>Total</b></span>
            <span class="ledger-delta num"><b>${r.total.toFixed(1)}</b></span>
          </div>
        </div>
        <div class="datastrip">${strip}</div>
        ${b.fellBack ? '<p class="muted" style="font-size:11.5px;margin:8px 0 0">The selected bracket had too few observations for this card, so the all-runs numbers were used instead.</p>' : ''}
      </div>
    </details>`;
}

/* ---------------------------------------------------------------- removals */

function renderRemovals() {
  const p = S.primary();
  if (!p.deck.length || !view.cardMetrics) return '';
  const list = Score.rankRemovals(ctx()).slice(0, 7);
  const eternal = p.deck
    .map((d) => game.cards.get(d.cardId))
    .filter((c) => c && Score.isEternal(c));
  if (!list.length && !eternal.length) return '';

  return `
    <div class="block">
      <h3>Best removals <span class="eyebrow">click to remove a copy</span></h3>
      ${list.map((r) => `
        <button class="removal" data-act="remove-one" data-id="${r.cardId}" title="Remove one copy of ${esc(r.card.name)} from your deck">
          <span class="spine" data-type="${r.card.type_key || r.card.type}"></span>
          <span>
            <span class="removal-name">${esc(r.card.name)}${r.copies > 1 ? ` <span class="muted num">×${r.copies}</span>` : ''}</span>
            <span class="removal-why">${esc(r.contributions.slice(0, 2).map((c) => c.label.toLowerCase()).join(' · ') || 'no strong signal')}</span>
          </span>
          <span class="removal-score num">${Math.round(r.total)}</span>
        </button>`).join('')}
      ${eternal.length ? `<p class="muted" style="font-size:11.5px;margin:8px 0 0">
        Not listed: ${eternal.map((c) => esc(c.name)).join(', ')} — Eternal cards cannot leave your deck.
      </p>` : ''}
      <p class="muted" style="font-size:11.5px;margin:8px 0 0">
        Removal has no direct community dataset, so this blends card statistics with how much each card is doing for this specific deck.
      </p>
    </div>`;
}

/* ------------------------------------------------------------------ picker */

const picker = { open: false, kind: 'card', purpose: 'deck', playerId: null, query: '', filters: {}, onPick: null };

export function openPicker(opts) {
  Object.assign(picker, { open: true, query: '', filters: {} }, opts);
  $('#picker').hidden = false;
  $('#picker-title').textContent = opts.title || 'Add card';
  const input = $('#picker-search');
  input.value = '';
  input.placeholder = picker.kind === 'relic'
    ? 'Search relics by name or effect'
    : 'Search by name, rules text or mechanic — try “poison” or “discard”';
  renderPicker();
  setTimeout(() => input.focus(), 0);
}

export function closePicker() {
  picker.open = false;
  $('#picker').hidden = true;
}

const TYPE_FILTERS = ['Attack', 'Skill', 'Power'];
const RARITY_FILTERS = ['Common', 'Uncommon', 'Rare'];

function renderPicker() {
  const p = S.primary();
  const forPlayer = picker.playerId ? S.playerById(picker.playerId) : p;
  const charId = forPlayer?.character || p.character;

  const pool = picker.kind === 'relic'
    ? relicPool(charId)
    : cardPool(charId, S.state.game.mode, picker.purpose === 'reward' ? 'reward' : 'deck');

  const results = search(pool, picker.query, picker.filters);

  $('#picker-filters').innerHTML = picker.kind === 'relic'
    ? ['Common', 'Uncommon', 'Rare', 'Boss', 'Shop', 'Ancient'].map((r) => `<button class="filter" data-act="pf-rarity" data-v="${r}" aria-pressed="${picker.filters.rarity === r}">${r}</button>`).join('')
    : [
      ...TYPE_FILTERS.map((t) => `<button class="filter" data-act="pf-type" data-v="${t}" aria-pressed="${picker.filters.type === t}">${t}</button>`),
      '<span style="width:10px"></span>',
      ...RARITY_FILTERS.map((r) => `<button class="filter" data-act="pf-rarity" data-v="${r}" aria-pressed="${picker.filters.rarity === r}">${r}</button>`),
    ].join('');

  $('#picker-grid').innerHTML = results.length
    ? results.slice(0, 300).map(albumTile).join('')
    : `<p class="empty" style="grid-column:1/-1">Nothing matches “${esc(picker.query)}”. Try a mechanic like “block” or “exhaust”.</p>`;
}

function albumTile(e) {
  const img = imageUrl(e);
  const isRelic = e.kind === 'relic';
  const rarity = e.rarity_key || e.rarity;
  const cost = e.cost === -1 ? 'X' : e.cost;
  const m = !isRelic && view.cardMetrics ? view.cardMetrics.get(e.id, false).row : null;
  return `
    <button class="albumcard" data-act="picker-pick" data-id="${e.id}" title="${esc(plain(e.description))}">
      <span class="albumcard-art ${isRelic ? 'albumcard-art--relic' : ''}" style="${img ? `background-image:url('${img}')` : ''}"></span>
      <span class="albumcard-body">
        <span class="albumcard-name">${esc(e.name)}</span>
        <span class="albumcard-meta">
          <span class="albumcard-rarity" data-rarity="${rarity}">${esc(rarity)}</span>
          ${isRelic ? '' : `<span>${cost ?? '—'}</span>`}
        </span>
        ${m?.score != null ? `<span class="albumcard-score">Codex ${m.score}${m.tier ? ` · ${m.tier}` : ''}</span>` : ''}
        <span class="albumcard-text">${rich(e.description).slice(0, 150)}</span>
      </span>
    </button>`;
}

export { renderPicker, picker, ctx };
