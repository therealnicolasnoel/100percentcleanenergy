// RSS/Atom feeds named in scan.json: investor essays and memos ("memo") and trade
// press ("news"). Only items that match a step's terms are kept later on.
import { record } from './record.mjs';

const pick = (e, ...tags) => {
  for (const t of tags) {
    const m = e.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`));
    if (m) return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
  }
  return '';
};
const link = (e) => pick(e, 'link') || (e.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] || '';

export async function search({ http, cfg, since }) {
  const out = [];
  for (const f of cfg ?? []) {
    const xml = await http.get('feeds', f.url, { as: 'text' });
    if (!xml) continue;
    const items = [...xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
    for (const e of items) {
      const date = pick(e, 'pubDate', 'published', 'updated', 'dc:date');
      const year = new Date(date).getUTCFullYear();
      if (year && year < since) continue;
      const url = link(e);
      out.push(record({
        id: `feed:${url || pick(e, 'guid', 'id')}`,
        source: f.name,
        kind: f.kind ?? 'news',
        title: pick(e, 'title'),
        url,
        date,
        summary: pick(e, 'description', 'summary', 'content:encoded', 'content'),
        matchText: pick(e, 'content:encoded', 'content'),
        orgs: f.kind === 'memo' ? [{ name: f.name, role: 'author', type: 'investor' }] : [],
        tags: [...e.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()).slice(0, 6),
        query: `feed:${f.name}`,
      }));
    }
  }
  return out;
}
