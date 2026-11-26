// OSTI.GOV: US Department of Energy research reports and papers. Public domain.
// https://www.osti.gov/api/v1/docs
import { record } from './record.mjs';

// "USDOE Office of Science (SC), Basic Energy Sciences" → "Office of Science"; "USDOE" → "U.S. Department of Energy".
const ORG = (s) => {
  const first = String(s).split(',')[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const rest = first.replace(/^USDOE\b\s*/, '').trim();
  return rest || 'U.S. Department of Energy';
};

export async function search({ http, queries, cfg, since }) {
  const out = [];
  for (const { query, step } of queries) {
    const url = `https://www.osti.gov/api/v1/records?q=${encodeURIComponent(`"${query}"`)}&rows=${cfg.per_query ?? 10}&publication_date_start=${encodeURIComponent(`01/01/${since}`)}`;
    const d = await http.get('osti', url, { headers: { accept: 'application/json' } });
    for (const r of Array.isArray(d) ? d : []) {
      const research = (r.research_orgs ?? []).map((n) => ({ name: ORG(n), role: 'author', type: 'research', country: 'US' }));
      const sponsors = (r.sponsor_orgs ?? []).map((n) => ({ name: ORG(n), role: 'sponsor', type: 'funder', country: 'US' }));
      out.push(record({
        id: `osti:${r.osti_id}`,
        source: 'OSTI',
        kind: /report/i.test(r.product_type ?? '') ? 'report' : 'paper',
        title: r.title,
        url: (r.links ?? []).find((l) => l.rel === 'citation')?.href ?? `https://www.osti.gov/biblio/${r.osti_id}`,
        date: r.publication_date,
        summary: r.description,
        orgs: [...research, ...sponsors].slice(0, 6),
        tags: (r.subjects ?? []).slice(0, 3),
        query, step,
      }));
    }
  }
  return out;
}
