/**
 * The hover card.
 *
 * Rows in this app are deliberately dense — a deck row is a name, a cost and a
 * quantity. The tooltip is where the rest of the card lives: the art, the full
 * rules text, the community numbers, and whatever weighting you have put on it.
 *
 * One element, reused. Anything carrying `data-tip="<id>"` is an anchor, and
 * `data-tip-kind="relic"` switches the lookup to the relic table. Because the
 * panels re-render wholesale on every state change, nothing may be bound to the
 * anchors themselves: this listens on the document and survives the redraw.
 */

import { game } from './data.js';
import { imageUrl } from './album.js';
import { esc, rich } from './format.js';
import { biasOf, biasBadge, tierShiftLabel, biasWord } from './bias.js';

/** Long enough not to fire while the pointer crosses a list, short enough to feel free. */
const OPEN_DELAY = 130;
const GAP = 12;

let el = null;
let anchor = null;
let openTimer = null;

/** Set by the app so this module does not need to know about view state. */
let metricsSource = () => null;
export function setMetricsSource(fn) { metricsSource = fn; }

export function initTooltips() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);

  document.addEventListener('pointerover', onOver);
  document.addEventListener('pointerout', onOut);
  document.addEventListener('focusin', onOver);
  document.addEventListener('focusout', onOut);
  // Any commitment — a click, a keypress, a scroll — means the tooltip is done.
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
}

function onOver(ev) {
  // A tap is a commitment, not a hover: on touch the row's own action wins.
  if (ev.pointerType === 'touch') return;
  const target = ev.target?.closest?.('[data-tip]');
  if (!target || target === anchor) return;
  clearTimeout(openTimer);
  anchor = target;
  // Once one card is up, moving along the list should not re-introduce the wait.
  if (el.hidden) openTimer = setTimeout(() => show(target), OPEN_DELAY);
  else show(target);
}

function onOut(ev) {
  if (!anchor) return;
  const to = ev.relatedTarget;
  if (to && anchor.contains(to)) return;
  hide();
}

export function hide() {
  clearTimeout(openTimer);
  anchor = null;
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

function show(target) {
  const id = target.dataset.tip;
  const kind = target.dataset.tipKind || 'card';
  const entity = kind === 'relic' ? game.relics.get(id) : game.cards.get(id);
  if (!entity) { hide(); return; }

  el.innerHTML = kind === 'relic'
    ? relicTip(entity)
    : cardTip(entity, target.dataset.tipUpgraded === 'true');
  el.hidden = false;
  place(target);
}

/* ------------------------------------------------------------------ content */

function head(entity, sub, upgraded = false) {
  const img = (upgraded && entity.image_url_card_upg) || imageUrl(entity);
  return `
    <div class="tip-head">
      ${img ? `<img class="tip-art" src="${img}" alt="">` : ''}
      <div class="tip-title">
        <span class="tip-name">${esc(entity.name)}${upgraded ? '<b class="tip-up">+</b>' : ''}</span>
        <span class="tip-sub num">${sub}</span>
      </div>
    </div>`;
}

function cardTip(card, upgraded) {
  const rarity = card.rarity_key || card.rarity;
  const cost = card.cost === -1 ? 'X' : card.cost ?? '—';
  const sub = [`${cost} energy`, esc(card.type), esc(rarity)].filter(Boolean).join(' · ');
  const bias = biasOf(card.id);

  // Hovering an upgraded copy should show the upgraded card, and hovering an
  // unupgraded one should show what upgrading would buy you.
  const text = upgraded ? (card.upgrade_description || card.description) : card.description;
  const preview = !upgraded && card.upgrade_description && card.upgrade_description !== card.description
    ? card.upgrade_description : null;

  // A starter card is in every run, so its win rate is just the global baseline
  // and its "pick rate" comes from stray offers. The engine ignores those
  // numbers (see `baseStrength`), so the tooltip must not imply they mean
  // something.
  const starter = (card.rarity_key || card.rarity) === 'Basic';
  const m = metricsSource()?.get(card.id, upgraded);
  const row = m?.row;
  const stats = !starter && row && row.picks ? [
    row.score != null ? `Codex <b>${row.score}</b>${row.tier ? ` · ${esc(row.tier)}-tier` : ''}` : '',
    row.winRate != null ? `win <b>${row.winRate.toFixed(1)}%</b>` : '',
    row.pickRate != null && row.offered >= 200 ? `taken <b>${row.pickRate.toFixed(0)}%</b>` : '',
  ].filter(Boolean).join(' · ') : '';

  const keywords = (card.keywords_key || card.keywords || []).filter(Boolean);

  return `
    ${head(card, sub, upgraded)}
    <div class="tip-text">${rich(text) || '<span class="tip-muted">No rules text.</span>'}</div>
    ${preview ? `<div class="tip-upgrade"><span class="tip-upgrade-tag">Upgraded</span>${rich(preview)}</div>` : ''}
    ${keywords.length ? `<div class="tip-tags">${keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
    ${stats ? `<div class="tip-stats">${stats}${m.fellBack ? ' <em>(all runs)</em>' : ''}</div>`
      : `<div class="tip-stats tip-muted">${starter ? 'Starter card — it is in every run, so community rates say nothing about it.' : 'No community statistics for this card.'}</div>`}
    ${bias ? `<div class="tip-bias">Your weighting <b>${biasBadge(bias)}</b> — ${esc(biasWord(bias))}${row?.tier ? `, ${esc(tierShiftLabel(bias, row.tier))}` : ''}</div>` : ''}`;
}

function relicTip(relic) {
  const sub = [esc(relic.rarity || relic.rarity_key), relic.pool && relic.pool !== 'shared' ? esc(relic.pool) : ''].filter(Boolean).join(' · ');
  return `
    ${head(relic, sub)}
    <div class="tip-text">${rich(relic.description) || '<span class="tip-muted">No rules text.</span>'}</div>`;
}

/* ---------------------------------------------------------------- placement */

/**
 * Prefers the side of the anchor with the most room, then falls back to below
 * or above it. The tooltip is fixed-position, so a scroll simply dismisses it.
 */
function place(target) {
  const a = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left;
  if (a.left > vw - a.right && a.left >= t.width + GAP) left = a.left - t.width - GAP;
  else if (vw - a.right >= t.width + GAP) left = a.right + GAP;
  else left = Math.max(GAP, Math.min(a.left, vw - t.width - GAP));

  let top = a.top + a.height / 2 - t.height / 2;
  top = Math.max(GAP, Math.min(top, vh - t.height - GAP));

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}
