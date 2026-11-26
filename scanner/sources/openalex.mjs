// OpenAlex: research papers with their institutions and funders. CC0, free.
// https://docs.openalex.org
import { record } from './record.mjs';

const ORG_KIND = { education: 'research', facility: 'research', healthcare: 'research', archive: 'research', company: 'company', government: 'policy', nonprofit: 'nonprofit', funder: 'funder', other: 'other' };

function abstract(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(' ');
}

export async function search({ http, queries, cfg, since, env }) {
  const out = [];
  for (const { query, step } of queries) {
    const q = new URLSearchParams({
      search: query,
      filter: `from_publication_date:${since}-01-01,type:article|preprint|review|report`,
      sort: 'relevance_score:desc',
      'per-page': String(cfg.per_query ?? 25),
      select: 'id,doi,display_name,publication_date,cited_by_count,authorships,funders,type,abstract_inverted_index,primary_location',
    });
    if (env.OPENALEX_API_KEY) q.set('api_key', env.OPENALEX_API_KEY);
    else if (env.OPENALEX_EMAIL) q.set('mailto', env.OPENALEX_EMAIL);
    const d = await http.get('openalex', `https://api.openalex.org/works?${q}`);
    for (const w of d?.results ?? []) {
      const orgs = new Map();
      for (const a of w.authorships ?? []) for (const i of a.institutions ?? []) {
        if (i.id && !orgs.has(i.id)) orgs.set(i.id, { name: i.display_name, role: 'author', type: ORG_KIND[i.type] ?? 'research', country: i.country_code ?? null, ids: { ror: i.ror ?? null, openalex: i.id.split('/').pop() } });
      }
      for (const f of w.funders ?? []) if (f.display_name) orgs.set(f.id, { name: f.display_name, role: 'funder', type: 'funder', ids: { ror: f.ror ?? null, openalex: f.id.split('/').pop() } });
      out.push(record({
        id: `openalex:${w.id.split('/').pop()}`,
        source: 'OpenAlex',
        kind: w.type === 'preprint' ? 'preprint' : w.type === 'report' ? 'report' : 'paper',
        title: w.display_name,
        url: w.doi ?? w.id,
        date: w.publication_date,
        summary: abstract(w.abstract_inverted_index),
        orgs: [...orgs.values()].slice(0, 8),
        metrics: { citations: w.cited_by_count ?? 0 },
        tags: [w.primary_location?.source?.display_name].filter(Boolean),
        query, step,
      }));
    }
  }
  return out;
}

/** Papers per year for a query: a cheap activity signal per step. */
export async function trend({ http, query, env, years = 6 }) {
  const now = new Date().getUTCFullYear();
  const q = new URLSearchParams({ search: query, filter: `from_publication_date:${now - years}-01-01,to_publication_date:${now - 1}-12-31`, group_by: 'publication_year' });
  if (env.OPENALEX_API_KEY) q.set('api_key', env.OPENALEX_API_KEY);
  else if (env.OPENALEX_EMAIL) q.set('mailto', env.OPENALEX_EMAIL);
  const d = await http.get('openalex', `https://api.openalex.org/works?${q}`);
  if (!d?.group_by) return null;
  const by = Object.fromEntries(d.group_by.map((g) => [Number(g.key), g.count]));
  return Array.from({ length: years }, (_, i) => now - years + i).map((y) => [y, by[y] ?? 0]);
}
