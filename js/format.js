/**
 * Text helpers shared by the panels and the hover card.
 *
 * The API marks rules text up with `[gold]...[/gold]`; we keep that emphasis
 * rather than stripping it, because the colours are the game's own keyword
 * language and players read them faster than the words.
 */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KW_COLOR = { gold: 'var(--gold)', blue: 'var(--t-skill)', red: 'var(--blood)', pink: 'var(--r-ancient)' };

export function rich(text) {
  return esc(text || '')
    .replace(/\[(\/?)([a-z]+)\]/gi, (m, close, name) => {
      const c = KW_COLOR[name.toLowerCase()];
      if (!c) return '';
      return close ? '</span>' : `<span style="color:${c}">`;
    })
    .replace(/\n/g, '<br>');
}

export const plain = (text) => String(text || '').replace(/\[\/?[a-z]+\]/gi, '').replace(/\n/g, ' ').trim();

/**
 * `rich`, but clamped to `max` *visible* characters.
 *
 * Truncating the rendered HTML instead would cut through a `<span>` and corrupt
 * every element after it, so the count runs over the source text, markup is
 * copied verbatim, and anything still open at the cut is closed.
 */
export function richClamp(text, max = 150) {
  const src = String(text || '');
  const re = /\[(\/?)([a-z]+)\]/gi;
  let out = '';
  let visible = 0;
  let open = 0;
  let cursor = 0;
  let clipped = false;

  const emit = (chunk) => {
    if (clipped || !chunk) return;
    const room = max - visible;
    if (chunk.length > room) {
      out += `${esc(chunk.slice(0, Math.max(0, room))).replace(/\n/g, '<br>')}…`;
      clipped = true;
      return;
    }
    visible += chunk.length;
    out += esc(chunk).replace(/\n/g, '<br>');
  };

  let m;
  while ((m = re.exec(src)) !== null) {
    emit(src.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    if (clipped) break;
    const color = KW_COLOR[m[2].toLowerCase()];
    if (!color) continue;
    if (m[1]) { if (open) { out += '</span>'; open -= 1; } }
    else { out += `<span style="color:${color}">`; open += 1; }
  }
  if (!clipped) emit(src.slice(cursor));

  return out + '</span>'.repeat(open);
}

export const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
