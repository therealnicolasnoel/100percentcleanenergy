// Step scanner: turns what the field scan found under each curated sub-goal into steps.
//
// A step is one OpenAlex research topic that dominates the papers filed under a
// sub-goal: e.g. "Optimal Power Flow Distribution" under "Grids that can move and
// balance clean power". Topics are stable ids, so steps keep their ids across scans
// and people can attach projects to them.
//
//   1. Count the primary topics of the papers already matched to each sub-goal
//      (these passed the domain filter, so "disease transmission" never gets in).
//   2. Give each topic to the sub-goal where it is strongest; keep the top
//      `steps.per_subgoal` with at least `steps.min_papers` papers.
//   3. Fetch each topic's description and keywords from OpenAlex.
//   4. File records under steps: papers by their topic, everything else by the
//      topic's keywords and name.
import { trend, topicInfo } from './sources/openalex.mjs';
import { hits } from './text.mjs';

const WORDS_STOP = new Set(['and', 'of', 'the', 'in', 'for', 'on', 'with', 'systems', 'system', 'analysis', 'studies', 'research', 'applications', 'techniques', 'technologies', 'methods', 'energy', 'power']);

export async function discoverSteps(records, { subgoals, cfg = {}, http, env, log = console.log }) {
  const perSub = cfg.per_subgoal ?? 6;
  const minPapers = cfg.min_papers ?? 4;
  const exclude = new Set(cfg.exclude_topics ?? []);
  const fields = cfg.topic_fields ? new Set(cfg.topic_fields) : null;
  const rename = cfg.rename ?? {};

  // 1. Weighted topic counts per sub-goal.
  const counts = new Map(); // topic → Map(subgoal → weight)
  const names = new Map();
  for (const r of records) {
    if (!r.topic?.id || exclude.has(r.topic.id) || (fields && r.topic.field && !fields.has(r.topic.field))) continue;
    names.set(r.topic.id, r.topic.name);
    for (const s of r.steps) {
      if (!subgoals.includes(s)) continue;
      const m = counts.get(r.topic.id) ?? new Map();
      m.set(s, (m.get(s) ?? 0) + 1);
      counts.set(r.topic.id, m);
    }
  }
  // 2. Each topic goes to its strongest sub-goal.
  const bySub = Object.fromEntries(subgoals.map((s) => [s, []]));
  for (const [t, m] of counts) {
    const [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= minPapers) bySub[best].push({ topic: t, papers: n });
  }
  const chosen = [];
  for (const s of subgoals) chosen.push(...bySub[s].sort((a, b) => b.papers - a.papers).slice(0, perSub).map((x) => ({ ...x, parent: s })));

  // 3. Topic details and activity.
  const steps = [];
  for (const c of chosen) {
    const info = (await topicInfo({ http, id: c.topic, env })) ?? { id: c.topic, name: names.get(c.topic), description: '', keywords: [], subfield: null, field: null, works_count: null, url: `https://openalex.org/${c.topic}` };
    const t = await trend({ http, topic: c.topic, env });
    steps.push({
      id: c.topic.toLowerCase(),
      parent: c.parent,
      title: rename[c.topic] ?? info.name,
      description: info.description,
      keywords: info.keywords,
      topic: { id: c.topic, subfield: info.subfield, field: info.field, works_count: info.works_count, url: info.url },
      papers: c.papers,
      trend: t,
      origin: 'scanner',
    });
  }
  log(`  steps: ${steps.length} steps under ${subgoals.length} sub-goals (${subgoals.map((s) => `${s} ${steps.filter((x) => x.parent === s).length}`).join(', ')})`);
  return steps;
}

/** Terms that identify a step in records without a topic (repos, startups, news). */
export function stepTerms(step) {
  const fromName = step.title.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 3 && !WORDS_STOP.has(w));
  return [...new Set([...step.keywords.map((k) => k.toLowerCase()), ...(fromName.length >= 2 ? [fromName.join(' ')] : [])])];
}

/**
 * Re-files records from sub-goals to steps. A record keeps the most specific place
 * it fits: the step when one matches, otherwise the sub-goal it was matched to.
 */
export function assignSteps(records, steps) {
  const bySub = new Map();
  for (const s of steps) bySub.set(s.parent, [...(bySub.get(s.parent) ?? []), { ...s, terms: stepTerms(s) }]);
  const byTopic = new Map(steps.map((s) => [s.topic.id, s]));
  for (const r of records) {
    const out = [];
    for (const sub of r.steps) {
      const candidates = bySub.get(sub);
      if (!candidates) { out.push(sub); continue; }
      const t = r.topic?.id && byTopic.get(r.topic.id);
      if (t && t.parent === sub) { out.push(t.id); continue; }
      const text = `${r.title} ${r.summary} ${(r.tags ?? []).join(' ')}`;
      const scored = candidates.map((c) => ({ id: c.id, n: hits(text, c.terms).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
      out.push(scored[0]?.id ?? sub);
    }
    r.steps = [...new Set(out)];
  }
}
