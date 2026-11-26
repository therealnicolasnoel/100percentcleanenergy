// Project scanner: concrete things people can join, use or back, filed under the
// tree's sub-goals and steps.
//
//   open_source  Open Sustainable Technology (ecosyste.ms, a curated directory of
//                open-source climate projects), the LF Energy landscape, and the
//                GitHub repositories the field scan found
//   startup      Y Combinator companies and "Launch HN" launches from the field scan
//   research     NSF awards from the field scan (funded research projects)
//
// People add their own projects as problems/<slug>/projects/<id>.json; the site reads
// those directly, so they don't pass through this scanner.
import { hits, normName } from './text.mjs';
import { stepTerms } from './steps.mjs';

async function ost(http, categories) {
  const out = [];
  for (let page = 1; page <= 8; page++) {
    const d = await http.get('ost', `https://ost.ecosyste.ms/api/v1/projects?per_page=1000&page=${page}`);
    if (!Array.isArray(d) || !d.length) break;
    for (const p of d) {
      if (!categories.includes(p.category)) continue;
      const repo = p.repository ?? {};
      out.push({
        id: `ost:${p.id}`,
        source: 'Open Sustainable Technology',
        kind: 'open_source',
        title: p.name,
        url: p.url,
        description: p.description ?? repo.description ?? '',
        tags: [p.category, p.sub_category, ...(Array.isArray(p.keywords) ? p.keywords : [])].filter(Boolean),
        actors: [repo.owner].filter(Boolean),
        metrics: { stars: repo.stargazers_count ?? null, language: p.language ?? repo.language ?? null, pushed: repo.pushed_at ?? null, ost_score: p.score ? Math.round(p.score * 10) / 10 : null },
        category: `${p.category} · ${p.sub_category}`,
      });
    }
    if (d.length < 1000) break;
  }
  return out;
}

/** Minimal reader for the LF Energy landscape.yml (a regular, two-level item list). */
async function lfEnergy(http) {
  const yml = await http.get('ost', 'https://raw.githubusercontent.com/lf-energy/lfenergy-landscape/main/landscape.yml', { as: 'text' });
  if (!yml) return [];
  const out = [];
  let cat = '', sub = '', item = null, inOrg = false;
  const flush = () => { if (item?.name) out.push(item); item = null; };
  for (const line of yml.split('\n')) {
    const m = line.match(/^(\s*)(?:- )?([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, indent, key, raw] = m;
    const val = raw.replace(/^['"]|['"]$/g, '').trim();
    if (key === 'category') { flush(); continue; }
    if (key === 'subcategory') { flush(); continue; }
    if (key === 'name' && indent.length <= 4) { cat = val; continue; }
    if (key === 'name' && indent.length <= 8 && !item) { sub = val; continue; }
    if (key === 'item') { flush(); item = { id: '', source: 'LF Energy landscape', kind: 'open_source', title: '', url: null, description: '', tags: [cat, sub], actors: [], metrics: {}, category: `${cat} · ${sub}` }; inOrg = false; continue; }
    if (!item) continue;
    if (key === 'organization') { inOrg = true; continue; }
    if (key === 'name') { if (inOrg) item.actors.push(val); else { item.name = val; item.title = val; } continue; }
    if (key === 'description') item.description = val;
    if (key === 'repo_url') item.url = val;
    if (key === 'homepage_url' && !item.url) item.url = val;
  }
  flush();
  return out.filter((p) => p.title).map((p) => ({ ...p, id: `lfe:${normName(p.title).replace(/ /g, '-')}` }));
}

function fromRecords(records) {
  const out = [];
  for (const r of records) {
    const actors = r.orgs.filter((o) => o.role === 'owner' || o.role === 'self' || o.role === 'awardee').map((o) => o.name);
    if (r.kind === 'repo') out.push({ id: r.id, source: 'GitHub', kind: 'open_source', title: r.title, url: r.url, description: r.summary, tags: r.tags, actors, metrics: { stars: r.metrics.stars ?? null, language: r.metrics.language ?? null, pushed: r.date }, steps: r.steps });
    else if (r.kind === 'startup' && r.source === 'Y Combinator') out.push({ id: r.id, source: 'Y Combinator', kind: 'startup', title: r.title, url: r.url, description: r.summary, tags: r.tags, actors, metrics: { batch: r.metrics.batch ?? null, status: r.metrics.status ?? null }, steps: r.steps });
    else if (r.kind === 'launch') out.push({ id: r.id, source: 'Hacker News', kind: 'startup', title: r.title.replace(/^(Launch|Show) HN:\s*/, ''), url: r.url, description: r.summary, tags: [], actors, metrics: { points: r.metrics.points ?? null }, steps: r.steps });
    else if (r.kind === 'grant') out.push({ id: r.id, source: r.source, kind: 'research', title: r.title, url: r.url, description: r.summary, tags: [], actors, metrics: { amount_usd: r.metrics.amount_usd ?? null, year: r.year }, steps: r.steps });
  }
  return out;
}

export async function scanProjects(records, { http, cfg = {}, subgoals, steps, contextTerms, log = console.log }) {
  const registry = [
    ...(cfg.ost_categories?.length ? await ost(http, cfg.ost_categories) : []),
    ...(cfg.lf_energy ? await lfEnergy(http) : []),
  ];
  const found = fromRecords(records);
  const stepsBySub = new Map();
  for (const s of steps) stepsBySub.set(s.parent, [...(stepsBySub.get(s.parent) ?? []), { id: s.id, terms: stepTerms(s) }]);

  // Registry projects aren't matched yet: file them by sub-goal terms, then step keywords.
  const place = (p) => {
    const text = `${p.title} ${p.description} ${p.tags.join(' ')}`;
    const subs = subgoals.map((s) => ({ id: s.id, n: hits(text, s.terms).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    if (!subs.length) return null;
    const sub = subs[0].id;
    const st = (stepsBySub.get(sub) ?? []).map((s) => ({ id: s.id, n: hits(text, s.terms).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
    return { subgoal: sub, step: st?.id ?? null };
  };
  const stepParent = new Map(steps.map((s) => [s.id, s.parent]));
  const out = [];
  const seen = new Set();
  const urlKey = (u) => String(u ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$|\/$/g, '');
  for (const p of [...registry, ...found]) {
    const k = urlKey(p.url) || p.id;
    if (seen.has(k)) continue;
    let where;
    if (p.steps) {
      const s = p.steps[0];
      where = stepParent.has(s) ? { subgoal: stepParent.get(s), step: s } : subgoals.some((g) => g.id === s) ? { subgoal: s, step: null } : place(p);
    } else {
      // Registry entries are already climate projects; still require the problem's domain.
      if (!hits(`${p.title} ${p.description} ${p.tags.join(' ')}`, contextTerms).length) continue;
      where = place(p);
    }
    if (!where) continue;
    seen.add(k);
    const m = p.metrics;
    const score = Math.log2(1 + (m.stars ?? 0)) + (m.ost_score ?? 0) / 4 + (p.kind === 'startup' ? 3 : 0) + (m.amount_usd ? Math.log10(m.amount_usd) / 2 : 0) + (m.pushed && m.pushed > '2024' ? 1 : 0);
    const { steps: _s, ...rest } = p;
    out.push({ ...rest, description: String(p.description ?? '').slice(0, 300), ...where, score: Math.round(score * 10) / 10 });
  }
  // Keep the strongest projects per step (and per sub-goal for unplaced ones).
  const per = cfg.per_step ?? 12;
  const groups = new Map();
  for (const p of out.sort((a, b) => b.score - a.score)) {
    const g = p.step ?? `sub:${p.subgoal}`;
    if ((groups.get(g) ?? 0) >= per) continue;
    groups.set(g, (groups.get(g) ?? 0) + 1);
    p.keep = true;
  }
  const kept = out.filter((p) => p.keep).map(({ keep, ...p }) => p);
  const by = kept.reduce((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {});
  log(`  projects: ${kept.length} kept of ${out.length} placed (${Object.entries(by).map(([k, v]) => `${v} ${k.replace('_', '-')}`).join(', ')}); registries returned ${registry.length}`);
  return { projects: kept, total_placed: out.length, registry: registry.length };
}

