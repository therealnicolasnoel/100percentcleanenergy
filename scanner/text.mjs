// Text helpers: cleaning, term matching and keyword extraction.

export function clean(s, max = 400) {
  const t = String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#039;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();
/** Whole-word, case-insensitive phrase matcher. "smr" does not match "smart". */
export function termRegex(term) {
  let r = cache.get(term);
  if (!r) {
    let body = esc(term.toLowerCase()).replace(/[-\s]+/g, '[-\\s]?');
    // Plurals: battery → batteries, grid → grids, ...
    body = /[a-z]y$/.test(body) ? `${body.slice(0, -1)}(y|ies)` : `${body}(s|es)?`;
    r = new RegExp(`(^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
    cache.set(term, r);
  }
  return r;
}

export function hits(text, terms) {
  const t = String(text ?? '').toLowerCase();
  return terms.filter((term) => termRegex(term).test(t));
}

const STOP = new Set(('a an and are as at be by for from has have in into is it its of on or that the to with without via than then this these those which who will would can could should may might must over under more most less every all any one two new make get reach reduce achieve enable ensure end scale world global per our your their we they you build building moved much faster time').split(' '));

export function keywords(text, max = 6) {
  const out = [];
  for (const w of String(text ?? '').toLowerCase().replace(/[€$£%]/g, ' ').split(/[^a-z0-9-]+/)) {
    const t = w.replace(/^-+|-+$/g, '');
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t) || out.includes(t)) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|ag|sa|plc|pbc|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
