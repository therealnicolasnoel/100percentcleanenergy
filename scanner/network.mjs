// Relationship scanner: who is connected to whom around a problem.
//
// Reads the field scan (problems/<slug>/field/records.json) and the curated network,
// then adds relationships from two places:
//
//   1. The field records themselves
//      - funds:        a funder or sponsor named on a paper, report or grant → the
//                      institutions that did the work (OpenAlex, OSTI, NSF)
//      - coauthors:    institutions that appear on the same papers (2+ shared papers)
//      - accelerated:  Y Combinator → its startups
//      - invests_in:   investors Wikidata lists for the companies found
//   2. Wikidata, for the top organisations (resolved by Wikidata id, ROR id or exact name)
//      - investor (P1951), funder (P8324), parent organisation (P749), owned by (P127),
//        subsidiary (P355), partnership with (P2652)
//
// Writes problems/<slug>/field/relations.json: organisation nodes, organisation →
// organisation edges with evidence, and organisation → step edges.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Http } from './http.mjs';
import { buildOrgs } from './orgs.mjs';
import { loadProblem } from './run.mjs';
import { normName } from './text.mjs';

const WD_PROPS = { P1951: 'investor', P8324: 'funder', P749: 'parent', P127: 'owner', P355: 'subsidiary', P2652: 'partner' };
const MAX_NODES = 140;

async function sparql(http, query) {
  const d = await http.get('wikidata', 'https://query.wikidata.org/sparql', {
    method: 'POST',
    body: new URLSearchParams({ query, format: 'json' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
  });
  return d?.results?.bindings ?? [];
}
const qid = (uri) => uri?.split('/').pop();

export async function runNetwork(dir, { cacheDir, offline = false, env = process.env, log = console.log } = {}) {
  const { meta, nodes, network } = loadProblem(dir);
  const file = join(dir, 'field', 'records.json');
  if (!existsSync(file)) throw new Error(`${file} is missing. Run the field scan first: npm run scan -- ${dir.split('/').pop()}`);
  const { records } = JSON.parse(readFileSync(file, 'utf8'));
  const http = new Http({ cacheDir, offline, env });

  const index = new Map();
  const orgs = buildOrgs(records, network, { index });
  const byKey = new Map(orgs.map((o) => [o.key, o]));
  const keyOf = (r, o) => index.get(`${r.id}|${o.name}`);

  const edges = new Map();
  const addEdge = (source, target, type, evidence) => {
    if (!source || !target || source === target) return;
    const undirected = type === 'coauthors' || type === 'partners';
    const [a, b] = undirected && source > target ? [target, source] : [source, target];
    const k = `${a}>${b}>${type}`;
    const e = edges.get(k) ?? { source: a, target: b, type, weight: 0, evidence: [] };
    e.weight++;
    if (evidence && e.evidence.length < 4 && !e.evidence.includes(evidence)) e.evidence.push(evidence);
    edges.set(k, e);
  };

  // 1. Relationships inside the field records.
  const coauth = new Map();
  for (const r of records) {
    const funders = r.orgs.filter((o) => o.role === 'funder' || o.role === 'sponsor').map((o) => keyOf(r, o)).filter(Boolean);
    const doers = r.orgs.filter((o) => o.role === 'author' || o.role === 'awardee').map((o) => keyOf(r, o)).filter(Boolean);
    for (const f of new Set(funders)) for (const d of [...new Set(doers)].slice(0, 6)) addEdge(f, d, 'funds', r.id);
    if (['paper', 'preprint', 'report'].includes(r.kind)) {
      const inst = [...new Set(doers)].slice(0, 6);
      for (let i = 0; i < inst.length; i++) for (let j = i + 1; j < inst.length; j++) {
        const k = [inst[i], inst[j]].sort().join('|');
        const c = coauth.get(k) ?? { n: 0, ev: [] };
        c.n++;
        if (c.ev.length < 4) c.ev.push(r.id);
        coauth.set(k, c);
      }
    }
    if (r.source === 'Y Combinator') {
      const self = r.orgs.find((o) => o.role === 'self');
      if (self) {
        const yc = 'n:y combinator';
        if (!byKey.has(yc)) byKey.set(yc, { key: yc, name: 'Y Combinator', type: 'incubator', records: 0, steps: {}, ids: {}, url: 'https://www.ycombinator.com', country: 'United States of America', in_network: null, score: 0 });
        addEdge(yc, keyOf(r, self), 'accelerated', r.id);
      }
    }
    for (const l of r.links ?? []) {
      const target = records.find((x) => x.id === l.to);
      const self = r.orgs.find((o) => o.role === 'self');
      const tSelf = target?.orgs.find((o) => o.role === 'self');
      if (self && tSelf) addEdge(keyOf(r, self), keyOf(target, tSelf), l.type, r.id);
    }
  }
  for (const [k, c] of coauth) if (c.n >= 2) {
    const [a, b] = k.split('|');
    const e = { source: a, target: b, type: 'coauthors', weight: c.n, evidence: c.ev };
    edges.set(`${a}>${b}>coauthors`, e);
  }

  // 2. Wikidata relationships for the top organisations and the curated network.
  const top = orgs.slice(0, 400);
  const wdOf = new Map(); // QID → org key
  for (const o of top) if (o.ids.wikidata) wdOf.set(o.ids.wikidata, o.key);
  const rors = top.filter((o) => o.ids.ror && !o.ids.wikidata).map((o) => [o.ids.ror.replace('https://ror.org/', ''), o.key]);
  for (let i = 0; i < rors.length; i += 150) {
    const chunk = rors.slice(i, i + 150);
    const rows = await sparql(http, `SELECT ?item ?ror WHERE { VALUES ?ror { ${chunk.map(([r]) => `"${r}"`).join(' ')} } ?item wdt:P6782 ?ror . }`);
    for (const b of rows) { const k = chunk.find(([r]) => r === b.ror.value)?.[1]; if (k) wdOf.set(qid(b.item.value), k); }
  }
  // Curated organisations: exact-name lookup so they join the graph even if the scan missed them.
  const curatedKey = new Map();
  for (const a of network) {
    const found = orgs.find((o) => o.in_network === a.id);
    const key = found?.key ?? `net:${a.id}`;
    curatedKey.set(a.id, key);
    if (!byKey.has(key)) byKey.set(key, { key, name: a.name, type: a.kind === 'builder' ? 'company' : a.kind, records: 0, steps: Object.fromEntries(a.works_on.map((s) => [s, 1])), ids: {}, url: a.url ?? null, country: a.country ?? null, in_network: a.id, score: 0 });
    if (![...wdOf.values()].includes(key)) {
      const d = await http.get('wikidata', `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(a.name)}&language=en&format=json&limit=3&type=item`);
      const hit = (d?.search ?? []).find((h) => [a.name, ...(a.aliases ?? [])].some((n) => normName(n) === normName(h.label)));
      if (hit) wdOf.set(hit.id, key);
    }
  }
  const qids = [...wdOf.keys()];
  const extra = new Map(); // organisations found only through Wikidata relationships
  for (let i = 0; i < qids.length; i += 120) {
    const chunk = qids.slice(i, i + 120);
    const rows = await sparql(http, `
      SELECT ?a ?p ?b ?bLabel ?bDescription WHERE {
        VALUES ?a { ${chunk.map((q) => `wd:${q}`).join(' ')} }
        VALUES ?p { ${Object.keys(WD_PROPS).map((p) => `wdt:${p}`).join(' ')} }
        ?a ?p ?b .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`);
    for (const b of rows) {
      const a = wdOf.get(qid(b.a.value));
      const prop = WD_PROPS[qid(b.p.value)];
      const bq = qid(b.b.value);
      const label = b.bLabel?.value;
      if (!label || /^Q\d+$/.test(label)) continue;
      let bk = wdOf.get(bq);
      // Bring in an outside organisation only as an investor or funder: that's how
      // new capital shows up. Parents, owners and partners must already be in the set.
      if (!bk && (prop === 'investor' || prop === 'funder')) {
        bk = `wd:${bq}`;
        const e = extra.get(bk) ?? { key: bk, name: label, type: prop === 'investor' ? 'investor' : 'funder', records: 0, steps: {}, ids: { wikidata: bq }, url: `https://www.wikidata.org/wiki/${bq}`, country: null, in_network: null, score: 0, description: b.bDescription?.value ?? null };
        extra.set(bk, e);
      }
      if (!bk) continue;
      const ev = `https://www.wikidata.org/wiki/${qid(b.a.value)}`;
      if (prop === 'investor') addEdge(bk, a, 'invests_in', ev);
      else if (prop === 'funder') addEdge(bk, a, 'funds', ev);
      else if (prop === 'parent' || prop === 'owner') addEdge(bk, a, 'parent_of', ev);
      else if (prop === 'subsidiary') addEdge(a, bk, 'parent_of', ev);
      else if (prop === 'partner') addEdge(a, bk, 'partners', ev);
    }
  }
  for (const [k, e] of extra) byKey.set(k, e);

  // Curated links count as relationships too.
  for (const a of network) for (const l of a.links ?? []) addEdge(curatedKey.get(a.id), curatedKey.get(l.to), l.type, `network:${a.id}`);

  // Pick the nodes for the map: every curated organisation, then the best-connected rest.
  const all = [...edges.values()];
  const degree = new Map();
  for (const e of all) for (const k of [e.source, e.target]) degree.set(k, (degree.get(k) ?? 0) + e.weight);
  const curated = [...curatedKey.values()];
  const rank = (k) => (degree.get(k) ?? 0) * 2 + (byKey.get(k)?.records ?? 0);
  const rest = [...byKey.keys()].filter((k) => !curated.includes(k) && (degree.get(k) ?? 0) > 0).sort((a, b) => rank(b) - rank(a));
  // A fair share per type, so hundreds of research institutions don't crowd out
  // startups and investors. Unused share goes to the best-connected of the rest.
  const QUOTA = { research: 30, funder: 25, startup: 22, company: 18, investor: 15, incubator: 8, builder: 6, policy: 8, nonprofit: 4, other: 2 };
  const chosen = new Set(curated);
  const used = {};
  for (const k of rest) {
    const t = byKey.get(k).type;
    if ((used[t] ?? 0) >= (QUOTA[t] ?? 2) || chosen.size >= MAX_NODES) continue;
    used[t] = (used[t] ?? 0) + 1;
    chosen.add(k);
  }
  for (const k of rest) { if (chosen.size >= MAX_NODES) break; chosen.add(k); }
  const kept = all.filter((e) => chosen.has(e.source) && chosen.has(e.target)).sort((a, b) => b.weight - a.weight);

  const outNodes = [...chosen].map((k) => {
    const o = byKey.get(k);
    const steps = Object.entries(o.steps ?? {}).filter(([s]) => nodes[s]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const cur = o.in_network ? network.find((a) => a.id === o.in_network) : null;
    return { key: k, name: cur?.name ?? o.name, type: o.type, in_network: o.in_network ?? null, records: o.records ?? 0, url: o.url ?? null, country: o.country ?? null, wikidata: o.ids?.wikidata ?? null, description: o.description ?? null, degree: degree.get(k) ?? 0, steps: Object.fromEntries(steps) };
  });
  const stepEdges = outNodes.flatMap((n) => Object.entries(n.steps).map(([s, w]) => ({ source: n.key, step: s, weight: w })));
  const counts = kept.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  const result = {
    generated_at: new Date().toISOString(),
    problem: meta.title,
    totals: { organisations: outNodes.length, relationships: kept.length, by_type: counts, wikidata_resolved: qids.length, from_wikidata: [...extra.keys()].filter((k) => chosen.has(k)).length },
    nodes: outNodes,
    edges: kept,
    step_edges: stepEdges,
  };
  writeFileSync(join(dir, 'field', 'relations.json'), JSON.stringify(result) + '\n');
  log(`  network: ${outNodes.length} organisations, ${kept.length} relationships (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}); ${qids.length} resolved on Wikidata`);
  return result;
}
