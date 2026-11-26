// The scan pipeline for one problem folder:
//   load tree + scan.json → query every source → dedupe → match to steps →
//   (optional) Claude review → build organisations → write problems/<slug>/field/*.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Http } from './http.mjs';
import { matchRecords, dedupe, propagateLinks } from './match.mjs';
import { buildOrgs } from './orgs.mjs';
import * as openalex from './sources/openalex.mjs';
import * as arxiv from './sources/arxiv.mjs';
import * as osti from './sources/osti.mjs';
import * as nsf from './sources/nsf.mjs';
import * as github from './sources/github.mjs';
import * as hackernews from './sources/hackernews.mjs';
import * as feeds from './sources/feeds.mjs';
import * as yc from './sources/yc.mjs';
import * as wikidata from './sources/wikidata.mjs';

export const SOURCE_IDS = ['openalex', 'arxiv', 'osti', 'nsf', 'github', 'hackernews', 'feeds', 'yc', 'wikidata', 'seeds'];
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadProblem(dir) {
  const meta = readJson(join(dir, 'keystone.json'));
  const nodes = Object.fromEntries(readdirSync(join(dir, 'map/nodes')).filter((f) => f.endsWith('.json')).map((f) => { const n = readJson(join(dir, 'map/nodes', f)); return [n.id, n]; }));
  const network = existsSync(join(dir, 'network')) ? readdirSync(join(dir, 'network')).filter((f) => f.endsWith('.json')).map((f) => readJson(join(dir, 'network', f))) : [];
  const scan = existsSync(join(dir, 'scan.json')) ? readJson(join(dir, 'scan.json')) : null;
  return { meta, nodes, network, scan };
}

export async function runScan(dir, { only = SOURCE_IDS, llm = false, offline = false, cacheDir, env = process.env, log = console.log } = {}) {
  const { meta, nodes, network, scan } = loadProblem(dir);
  if (!scan) throw new Error(`${dir}/scan.json is missing. Run: npm run scan:init -- ${dir.split('/').pop()}`);
  const since = scan.since ?? new Date().getUTCFullYear() - 6;
  const steps = Object.entries(scan.steps).map(([id, s]) => {
    if (!nodes[id]) throw new Error(`scan.json: step "${id}" is not in map/nodes/.`);
    return { id, title: nodes[id].title, description: nodes[id].description, terms: s.terms ?? [], queries: s.queries?.length ? s.queries : [nodes[id].title] };
  });
  const contextTerms = scan.context_terms ?? [];
  const http = new Http({ cacheDir, offline, env });
  const q = (n) => steps.flatMap((s) => s.queries.slice(0, n).map((query) => ({ query, step: s.id })));
  const ctx = (name) => ({ http, cfg: scan.sources?.[name] ?? {}, since, env, contextTerms });

  const jobs = {
    openalex: () => openalex.search({ ...ctx('openalex'), queries: q(3) }),
    arxiv: () => arxiv.search({ ...ctx('arxiv'), queries: q(1) }),
    osti: () => osti.search({ ...ctx('osti'), queries: q(1) }),
    nsf: () => nsf.search({ ...ctx('nsf'), queries: q(1) }),
    github: () => github.search({ ...ctx('github'), queries: q(1) }),
    hackernews: () => hackernews.search({ ...ctx('hackernews'), queries: q(2) }),
    feeds: () => feeds.search({ http, cfg: scan.sources?.feeds ?? [], since }),
    yc: () => yc.search({ ...ctx('yc') }),
    wikidata: () => wikidata.search({ ...ctx('wikidata') }),
    seeds: () => wikidata.seeds({ http, seeds: scan.seeds }),
  };

  // Sources run in parallel; each one paces its own requests.
  const raw = [];
  const perSource = {};
  await Promise.all(only.filter((s) => jobs[s]).map(async (s) => {
    const t = Date.now();
    let recs = [];
    try { recs = await jobs[s](); } catch (e) { log(`  ${s}: failed: ${e.message}`); }
    perSource[s] = { fetched: recs.length, seconds: Math.round((Date.now() - t) / 1000) };
    log(`  ${s}: ${recs.length} records`);
    raw.push(...recs);
  }));

  const unique = dedupe(raw);
  const root = meta.root;
  let { kept, dropped } = matchRecords(unique, { steps, root, contextTerms });
  propagateLinks(kept);
  let llmReport = null;
  if (llm) {
    const r = await (await import('./classify.mjs')).classify(kept, { problemTitle: meta.title, steps, cacheDir, env, log });
    kept = r.records;
    llmReport = r.report;
    propagateLinks(kept);
  }
  for (const r of kept) {
    const src = r.source === 'Seed list' ? 'seeds' : null;
    const k = src ?? Object.keys(perSource).find((s) => r.id.startsWith(`${s}:`)) ?? null;
    if (k && perSource[k]) perSource[k].kept = (perSource[k].kept ?? 0) + 1;
  }
  for (const s of Object.keys(perSource)) perSource[s].kept ??= 0;
  perSource.feeds && (perSource.feeds.kept = kept.filter((r) => r.id.startsWith('feed:')).length);
  perSource.hackernews && (perSource.hackernews.kept = kept.filter((r) => r.id.startsWith('hn:')).length);
  perSource.wikidata && (perSource.wikidata.kept = kept.filter((r) => r.id.startsWith('wikidata:') && r.source !== 'Seed list').length);

  // Activity per step: papers per year in OpenAlex.
  const trends = {};
  if (only.includes('openalex')) for (const s of steps) trends[s.id] = await openalex.trend({ http, query: s.queries[0], env });

  const orgs = buildOrgs(kept, network);
  const rank = (r) => (r.metrics.citations ?? 0) / 10 + (r.metrics.stars ?? 0) / 50 + (r.metrics.points ?? 0) / 20 + r.relevance * 2 + (r.year ? (r.year - since) / 2 : 0);
  const records = kept
    .map(({ domainScoped, seedSteps, via, matchText, ...r }) => ({ ...r, queries: [...new Set(via.map((v) => v.query))].slice(0, 4) }))
    .sort((a, b) => rank(b) - rank(a));

  const counts = {};
  for (const s of steps) counts[s.id] = {};
  for (const r of records) for (const s of r.steps) { counts[s] ??= {}; counts[s][r.kind] = (counts[s][r.kind] ?? 0) + 1; }

  const out = join(dir, 'field');
  mkdirSync(out, { recursive: true });
  const generated_at = new Date().toISOString();
  writeFileSync(join(out, 'records.json'), JSON.stringify({ generated_at, records }, null, 0) + '\n');
  writeFileSync(join(out, 'organisations.json'), JSON.stringify({ generated_at, organisations: orgs.slice(0, 600) }, null, 0) + '\n');
  writeFileSync(join(out, 'summary.json'), JSON.stringify({
    generated_at,
    since,
    totals: { fetched: raw.length, unique: unique.length, kept: records.length, organisations: orgs.length, dropped },
    sources: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, { ...v, ...(http.health()[k === 'seeds' ? 'wikidata' : k] ?? {}) }])),
    steps: counts,
    trends,
    llm: llmReport,
  }, null, 2) + '\n');
  return { fetched: raw.length, unique: unique.length, kept: records.length, orgs: orgs.length, dropped, perSource, llm: llmReport };
}

/** Writes a starting scan.json from a problem's tree. Tune the terms by hand afterwards. */
export function initScan(dir) {
  const { nodes, meta } = loadProblem(dir);
  const steps = {};
  for (const n of Object.values(nodes)) {
    const t = n.title.toLowerCase().replace(/[^a-z0-9%\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    steps[n.id] = { terms: [t], queries: [n.title] };
  }
  const scan = {
    $comment: `Starter config for "${meta.title}". Replace each step's terms with specific phrases researchers and companies use, and add context_terms that mark the problem's domain.`,
    since: new Date().getUTCFullYear() - 6,
    context_terms: [],
    steps,
    sources: { openalex: { per_query: 25 }, arxiv: { per_query: 8 }, github: { per_query: 12, min_stars: 5, topics: [] }, hackernews: { per_query: 12, min_points: 15 }, osti: { per_query: 10 }, nsf: { per_query: 8 }, yc: { tags: [] }, wikidata: { industries: {}, limit: 300 }, feeds: [] },
    seeds: [],
  };
  writeFileSync(join(dir, 'scan.json'), JSON.stringify(scan, null, 2) + '\n');
  return join(dir, 'scan.json');
}
