// Hacker News via the official Algolia search API: startup launches ("Launch HN",
// "Show HN") and widely discussed posts. https://hn.algolia.com/api
import { record } from './record.mjs';

// "Launch HN: Acme (YC W24) – Grid batteries" → "Acme"
function launchName(title) {
  const m = title.match(/^(?:Launch|Show) HN:\s*([^–—\-:(]+?)\s*(?:\(YC [A-Z]\d{2}\))?\s*[–—\-:]/);
  return m ? m[1].trim() : null;
}

export async function search({ http, queries, cfg, since }) {
  const after = Math.floor(Date.UTC(since, 0, 1) / 1000);
  const out = [];
  for (const { query, step } of queries) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${cfg.per_query ?? 12}&numericFilters=${encodeURIComponent(`created_at_i>${after},points>=${cfg.min_points ?? 15}`)}`;
    const d = await http.get('hackernews', url);
    for (const h of d?.hits ?? []) {
      if (!h.title) continue;
      const launch = /^(Launch|Show) HN:/.test(h.title);
      const name = launch ? launchName(h.title) : null;
      out.push(record({
        id: `hn:${h.objectID}`,
        source: 'Hacker News',
        kind: launch ? 'launch' : 'news',
        title: h.title,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        date: h.created_at,
        summary: h.story_text ?? '',
        orgs: name ? [{ name, role: 'self', type: /\(YC [A-Z]\d{2}\)/.test(h.title) ? 'startup' : 'builder' }] : [],
        metrics: { points: h.points, comments: h.num_comments, discussion: `https://news.ycombinator.com/item?id=${h.objectID}` },
        query, step,
      }));
    }
  }
  return out;
}
