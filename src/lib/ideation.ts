/**
 * The context the local ideation model reads: every section of a problem, in one
 * compact plain-text brief, plus small structured lists the page uses to place and
 * check ideas without asking the model (sub-goals, steps, projects, organisations).
 * Built at build time; shown verbatim on the page so people can see what the model sees.
 */
import type { ProblemData } from './problemData';
import type { Field } from './field';
import { GROUPS, landscape } from './field';
import type { Relations } from './relations';
import { GROUP_OF, GROUP_LABEL } from './relations';
import type { Forecast } from './forecast';
import { isOngoing, projectWeight, projectSuccess } from './simulate';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface IdeaContext {
  text: string;
  chars: number;
  subgoals: { id: string; title: string; description: string; terms: string[] }[];
  steps: { id: string; title: string; subgoal: string; keywords: string[] }[];
  projects: { key: string; title: string; subgoal: string; step: string | null; kind: string; text: string; url: string | null }[];
  orgs: { name: string; type: string; steps: string[]; url: string | null }[];
  /** Where the forecast's best-path says new projects help most. */
  focusSteps: { id: string; subgoal: string; count: number }[];
  /** The sub-goal that most often finishes last on main. */
  bottleneck: string | null;
  target: number;
}

const cut = (s: string | null | undefined, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const yr = (y: number, start: number) => (Number.isFinite(y) && y < start + 75 ? String(Math.round(y)) : 'not within 75 years');

export function buildIdeaContext(data: ProblemData, field: Field | null, rel: Relations | null, F: Forecast, problemTitle: string, problemNumber: number): IdeaContext {
  const t = (id: string) => data.nodes[id]?.title ?? id;
  const subs = data.nodes[data.root].children;
  const L: string[] = [];
  const land = field ? landscape(field, data) : null;
  const act = (id: string) => land?.rows.find((r) => r.id === id);

  // 1. Problem, sub-goals and steps (the tree map).
  L.push(`# Problem ${problemNumber}: ${problemTitle}`);
  if (data.nodes[data.root].description) L.push(cut(data.nodes[data.root].description, 500));
  L.push('', '## Sub-goals (curated by people) and their steps (generated from research topics)');
  for (const s of subs) {
    const n = data.nodes[s];
    const e = n.estimate;
    L.push(`- [${s}] ${n.title}. Status: ${n.status.replace('_', ' ')}${n.blocker ? '; MAIN BLOCKER' : ''}${n.logic === 'OR' ? '; any one step is enough' : ''}.${e ? ` Estimate without projects: ${e.p10}–${e.p90} years, ${pct(e.p_success)} doable.` : ''} ${cut(n.description, 320)}`);
    for (const c of n.children) {
      const sn = data.nodes[c];
      const a = act(c);
      L.push(`  - step [${c}] ${sn.title}: ${sn.papers ?? 0} papers in the scan, ${data.projectsOn[c]?.length ?? 0} projects${a ? `, ${a.total} items found` : ''}. Keywords: ${(sn.keywords ?? []).slice(0, 6).join(', ')}.`);
    }
    const own = data.projectsOn[s]?.length ?? 0;
    if (own) L.push(`  - ${own} more projects serve this sub-goal without a specific step.`);
  }

  // 2. Forecast (Monte Carlo, illustrative).
  const main = F.branches.find((b) => b.kind === 'main')!;
  const best = F.branches.find((b) => b.kind === 'best')!;
  L.push('', `## Forecast (Monte Carlo simulation, illustrative; based on assumed estimates)`);
  L.push(`- main (tracked projects as they are): ${pct(main.p)} chance by ${F.target}; reached in half of futures by ${yr(main.median, F.start)}; bottleneck: ${t(main.bottleneck ?? '')}.`);
  L.push(`- best-path (${best.newProjects} new projects where they help most): ${pct(best.p)} by ${F.target} (${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(1)} points). Start projects on: ${best.starts.map((s) => `${t(s.unit)} (+${s.count})`).join('; ')}.`);
  for (const b of F.branches.filter((x) => x.kind !== 'main' && x.kind !== 'best')) L.push(`- ${b.name}: ${pct(b.p)} by ${F.target} (${b.delta >= 0 ? '+' : ''}${b.delta.toFixed(1)} points), bottleneck ${t(b.bottleneck ?? '')}.`);
  if (F.critical.length) L.push(`- Tracked projects that matter most: ${F.critical.map((c) => `${c.title} (−${c.drop.toFixed(1)} points if it stops)`).join('; ')}.`);

  // 3. Projects.
  const ongoing = data.projects.filter((p) => isOngoing(p)).sort((a, b) => projectWeight(b) * projectSuccess(b) - projectWeight(a) * projectSuccess(a));
  L.push('', `## Leading ongoing projects (${ongoing.length} ongoing of ${data.projects.length} tracked; top 25)`);
  for (const p of ongoing.slice(0, 25)) L.push(`- ${p.title} [${p.kind.replace('_', ' ')}] → ${p.step ? t(p.step) : t(p.subgoal)}: ${cut(p.description, 110)}`);
  const empty = data.order.filter((id) => data.nodes[id].type === 'step' && !(data.projectsOn[id]?.length));
  if (empty.length) L.push(`- Steps with no tracked project: ${empty.map(t).join('; ')}.`);

  // 4. Who's working on it.
  if (field) {
    L.push('', `## Who's working on it (${field.summary.totals.organisations} organisations found)`);
    const byGroup: Record<string, typeof field.orgs> = {};
    for (const o of field.orgs) (byGroup[GROUP_OF[o.type] ?? 'policy'] ??= []).push(o);
    for (const [g, list] of Object.entries(byGroup)) {
      L.push(`- ${GROUP_LABEL[g as keyof typeof GROUP_LABEL]} (${list.length}): ${list.slice(0, 12).map((o) => `${o.name}${Object.keys(o.steps)[0] ? ` (${t(Object.keys(o.steps)[0])})` : ''}`).join('; ')}.`);
    }
  }
  if (data.actors.length) L.push(`- Curated network: ${data.actors.map((a) => `${a.name} (${a.kind}; ${a.works_on.map(t).join(', ')})`).join('; ')}.`);
  if (rel) {
    const name = new Map(rel.nodes.map((n) => [n.key, n.name]));
    const top = rel.edges.filter((e) => e.type !== 'coauthors').slice(0, 14);
    L.push(`- Strongest relationships: ${top.map((e) => `${name.get(e.source)} ${e.type.replace('_', ' ')} ${name.get(e.target)}`).join('; ')}.`);
  }

  // 5. State of the field.
  if (field && land) {
    L.push('', `## State of the field (${field.summary.totals.kept} items from open sources)`);
    for (const s of subs) {
      const a = act(s)!;
      const tr = field.summary.trends[s];
      const change = tr && tr.length > 1 && tr[0][1] ? Math.round(((tr[tr.length - 1][1] - tr[0][1]) / tr[0][1]) * 100) : null;
      L.push(`- ${t(s)}: ${GROUPS.filter((g) => a.counts[g.id]).map((g) => `${a.counts[g.id]} ${g.label.toLowerCase()}`).join(', ')}${change !== null ? `; papers per year ${change >= 0 ? '+' : ''}${change}% since ${tr![0][0]}` : ''}.`);
      const cited = field.records.filter((r) => r.steps.some((x) => x === s || data.nodes[x]?.parent === s) && ['paper', 'report'].includes(r.kind)).sort((x, y) => Number(y.metrics.citations ?? 0) - Number(x.metrics.citations ?? 0)).slice(0, 3);
      if (cited.length) L.push(`  Most cited: ${cited.map((r) => `"${cut(r.title, 90)}" (${r.year})`).join('; ')}.`);
    }
    if (land.quiet.size) L.push(`- Little activity: ${[...land.quiet].map(t).join('; ')}.`);
    const memos = field.records.filter((r) => r.kind === 'memo').slice(0, 5);
    if (memos.length) L.push(`- Recent investor memos: ${memos.map((r) => `"${cut(r.title, 70)}" (${r.source})`).join('; ')}.`);
  }

  const text = L.join('\n');
  // The search terms people wrote for each sub-goal (scan.json) help place ideas.
  const scanFile = join(process.cwd(), 'problems', data.folder, 'scan.json');
  const scanTerms: Record<string, string[]> = existsSync(scanFile)
    ? Object.fromEntries(Object.entries((JSON.parse(readFileSync(scanFile, 'utf8')).subgoals ?? {}) as Record<string, { terms?: string[] }>).map(([k, v]) => [k, v.terms ?? []]))
    : {};
  return {
    text,
    chars: text.length,
    target: F.target,
    bottleneck: main.bottleneck,
    focusSteps: best.starts.map((x) => ({ id: x.unit, subgoal: x.subgoal, count: x.count })),
    subgoals: subs.map((s) => ({ id: s, title: t(s), description: cut(data.nodes[s].description, 220), terms: (scanTerms[s] ?? []).slice(0, 24) })),
    steps: data.order.filter((id) => data.nodes[id].type === 'step').map((id) => ({ id, title: t(id), subgoal: data.nodes[id].parent!, keywords: data.nodes[id].keywords ?? [] })),
    projects: data.projects.map((p) => ({ key: p.key, title: p.title, subgoal: p.subgoal, step: p.step, kind: p.kind, text: cut(`${p.title} ${p.description}`, 260).toLowerCase(), url: p.url })),
    orgs: (field?.orgs ?? []).slice(0, 400).map((o) => ({ name: o.name, type: o.type, steps: Object.keys(o.steps).slice(0, 4), url: o.url })),
  };
}
