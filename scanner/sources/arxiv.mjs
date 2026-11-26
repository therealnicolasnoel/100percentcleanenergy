// arXiv preprints. Metadata CC0. https://info.arxiv.org/help/api/
import { record } from './record.mjs';

const tag = (e, t) => (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) ?? [])[1] ?? '';

export async function search({ http, queries, cfg }) {
  const out = [];
  for (const { query, step } of queries) {
    const q = encodeURIComponent(`all:"${query}"`);
    const xml = await http.get('arxiv', `https://export.arxiv.org/api/query?search_query=${q}&max_results=${cfg.per_query ?? 8}&sortBy=relevance`, { as: 'text' });
    if (!xml) continue;
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const e = m[1];
      const id = tag(e, 'id').trim();
      const affs = [...e.matchAll(/<arxiv:affiliation[^>]*>([\s\S]*?)<\/arxiv:affiliation>/g)].map((a) => a[1].trim());
      out.push(record({
        id: `arxiv:${id.split('/abs/').pop().replace(/v\d+$/, '')}`,
        source: 'arXiv',
        kind: 'preprint',
        title: tag(e, 'title'),
        url: id.replace('http://', 'https://'),
        date: tag(e, 'published'),
        summary: tag(e, 'summary'),
        orgs: [...new Set(affs)].slice(0, 5).map((name) => ({ name, role: 'author', type: 'research' })),
        query, step,
      }));
    }
  }
  return out;
}
