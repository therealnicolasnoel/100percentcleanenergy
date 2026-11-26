// Wikidata (CC0): companies in the industries named in scan.json, the investors
// Wikidata lists for them, incubators and accelerators, and the seed organisations.
import { record } from './record.mjs';
import { hits, normName } from '../text.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const qid = (uri) => uri?.split('/').pop();
const v = (b, k) => b[k]?.value ?? null;

async function sparql(http, query) {
  const d = await http.get('wikidata', `${SPARQL}?query=${encodeURIComponent(query)}&format=json`, { headers: { accept: 'application/sparql-results+json' } });
  return d?.results?.bindings ?? [];
}

export async function search({ http, cfg, contextTerms }) {
  const industries = Object.keys(cfg.industries ?? {});
  const out = [];
  if (industries.length) {
    const rows = await sparql(http, `
      SELECT ?c ?cLabel ?cDescription ?inception ?website ?countryLabel ?indLabel ?inv ?invLabel WHERE {
        VALUES ?ind { ${industries.map((q) => `wd:${q}`).join(' ')} }
        ?c wdt:P452 ?ind .
        ?c wdt:P31/wdt:P279* wd:Q4830453 .
        FILTER NOT EXISTS { ?c wdt:P576 ?dissolved }
        OPTIONAL { ?c wdt:P571 ?inception }
        OPTIONAL { ?c wdt:P856 ?website }
        OPTIONAL { ?c wdt:P17 ?country }
        OPTIONAL { ?c wdt:P1951 ?inv }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } LIMIT ${(cfg.limit ?? 400) * 3}`);
    const companies = new Map();
    for (const b of rows) {
      const id = qid(v(b, 'c'));
      const c = companies.get(id) ?? { id, name: v(b, 'cLabel'), desc: v(b, 'cDescription'), inception: v(b, 'inception'), website: v(b, 'website'), country: v(b, 'countryLabel'), industries: new Set(), investors: new Map() };
      if (v(b, 'indLabel')) c.industries.add(v(b, 'indLabel'));
      if (v(b, 'inv')) c.investors.set(qid(v(b, 'inv')), v(b, 'invLabel'));
      companies.set(id, c);
    }
    const investors = new Map();
    for (const c of [...companies.values()].slice(0, cfg.limit ?? 400)) {
      if (!c.name || /^Q\d+$/.test(c.name)) continue;
      const year = c.inception ? Number(c.inception.slice(0, 4)) : null;
      out.push(record({
        id: `wikidata:${c.id}`,
        source: 'Wikidata',
        kind: 'company',
        title: c.name,
        url: c.website ?? `https://www.wikidata.org/wiki/${c.id}`,
        date: year ? `${year}-01-01` : null,
        summary: [c.desc, `Industry: ${[...c.industries].join(', ')}`].filter(Boolean).join('. '),
        orgs: [
          { name: c.name, role: 'self', type: 'company', country: c.country, url: c.website, ids: { wikidata: c.id } },
          ...[...c.investors].map(([iid, name]) => ({ name, role: 'investor', type: 'investor', ids: { wikidata: iid } })),
        ],
        metrics: { founded: year, wikidata: `https://www.wikidata.org/wiki/${c.id}` },
        tags: [...c.industries],
        domainScoped: true,
        query: 'wikidata-industries',
      }));
      for (const [iid, name] of c.investors) {
        const i = investors.get(iid) ?? { name, companies: [] };
        i.companies.push({ id: `wikidata:${c.id}`, name: c.name });
        investors.set(iid, i);
      }
    }
    for (const [iid, i] of investors) {
      if (!i.name || /^Q\d+$/.test(i.name)) continue;
      out.push(record({
        id: `wikidata:${iid}`,
        source: 'Wikidata',
        kind: 'investor',
        title: i.name,
        url: `https://www.wikidata.org/wiki/${iid}`,
        summary: `Investor in ${i.companies.map((c) => c.name).join(', ')} (Wikidata).`,
        orgs: [{ name: i.name, role: 'self', type: 'investor', ids: { wikidata: iid } }],
        links: i.companies.map((c) => ({ to: c.id, type: 'invests_in' })),
        domainScoped: true,
        query: 'wikidata-investors',
      }));
    }
  }

  // Incubators and accelerators whose description mentions the problem's domain.
  const inc = await sparql(http, `
    SELECT ?i ?iLabel ?iDescription ?website ?countryLabel ?inception WHERE {
      VALUES ?cls { wd:Q1132207 wd:Q4086495 }
      ?i wdt:P31 ?cls .
      OPTIONAL { ?i wdt:P856 ?website }
      OPTIONAL { ?i wdt:P17 ?country }
      OPTIONAL { ?i wdt:P571 ?inception }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 3000`);
  for (const b of inc) {
    const text = `${v(b, 'iLabel')} ${v(b, 'iDescription') ?? ''}`;
    if (!hits(text, contextTerms).length) continue;
    const id = qid(v(b, 'i'));
    out.push(record({
      id: `wikidata:${id}`,
      source: 'Wikidata',
      kind: 'incubator',
      title: v(b, 'iLabel'),
      url: v(b, 'website') ?? `https://www.wikidata.org/wiki/${id}`,
      date: v(b, 'inception'),
      summary: v(b, 'iDescription'),
      orgs: [{ name: v(b, 'iLabel'), role: 'self', type: 'incubator', country: v(b, 'countryLabel'), ids: { wikidata: id } }],
      domainScoped: true,
      query: 'wikidata-incubators',
    }));
  }
  return out;
}

/** Seed organisations named in scan.json, enriched from Wikidata when found. */
export async function seeds({ http, seeds }) {
  const out = [];
  for (const s of seeds ?? []) {
    const d = await http.get('wikidata', `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(s.wikidata_search ?? s.name)}&language=en&format=json&limit=1&type=item`);
    // Trust the lookup only when the label is the same name (or the seed names its own search).
    const first = d?.search?.[0];
    const hit = first && (s.wikidata_search || normName(first.label) === normName(s.name)) ? first : null;
    let website = s.url ?? null;
    if (hit && !website) {
      const e = await http.get('wikidata', `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${hit.id}&property=P856&format=json`);
      website = e?.claims?.P856?.[0]?.mainsnak?.datavalue?.value ?? null;
    }
    out.push(record({
      id: hit ? `wikidata:${hit.id}` : `seed:${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      source: 'Seed list',
      kind: s.kind,
      title: s.name,
      url: website ?? (hit ? `https://www.wikidata.org/wiki/${hit.id}` : null),
      summary: hit?.description ?? s.description ?? '',
      orgs: [{ name: s.name, role: 'self', type: s.kind, url: website, ids: hit ? { wikidata: hit.id } : {} }],
      metrics: hit ? { wikidata: `https://www.wikidata.org/wiki/${hit.id}` } : {},
      domainScoped: true,
      query: 'seed',
      step: s.steps?.[0] ?? null,
    }));
    if (s.steps?.length) out[out.length - 1].seedSteps = s.steps;
  }
  return out;
}
