/**
 * Git-style forecast: different ways of reaching the goal, as branches off `main`.
 *
 *   main          today's trajectory: the tracked projects as they are
 *   best-path     where new projects help most, found one pair at a time (greedy
 *                 search over every step, on common random numbers)
 *   focus/<id>    the same number of new projects, all on one sub-goal
 *   balanced      the same number spread evenly over every sub-goal
 *   risk/stall    no new projects, and the tracked ones deliver half as often
 *
 * Each branch carries commits: the projects to start (where and how many), the
 * year each sub-goal is likely done, and when the goal is reached in half of the
 * simulated futures. `main` also lists the tracked projects that matter most,
 * found by switching each one off.
 */
import { simulate, pBy, DEFAULT_SCENARIO, HORIZON, type SimModel, type Scenario, type SimResult } from './simulate';
import type { ProblemData } from './problemData';

export interface Commit {
  hash: string;
  year: number;
  kind: 'fork' | 'start' | 'keep' | 'risk' | 'milestone' | 'goal';
  message: string;
  subgoal?: string;
  step?: string;
  count?: number;
  /** Chance of reaching the goal by the target year after this commit. */
  p?: number;
  bottleneck?: boolean;
}
export interface Branch {
  id: string;
  name: string;
  summary: string;
  kind: 'main' | 'best' | 'focus' | 'balanced' | 'risk';
  newProjects: number;
  p: number;
  delta: number;
  median: number;
  bottleneck: string | null;
  commits: Commit[];
  /** Units (steps) that get new projects, with counts. */
  starts: { unit: string; subgoal: string; count: number }[];
}
export interface Forecast { target: number; start: number; budget: number; runs: number; branches: Branch[]; critical: { key: string; title: string; drop: number }[] }

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7);
}

export function buildForecast(model: SimModel, data: ProblemData, { target = 2050, budget = 12, runs = 1500 } = {}): Forecast {
  const base: Scenario = { ...DEFAULT_SCENARIO, runs };
  const run = (sc: Partial<Scenario>) => simulate(model, { ...base, ...sc });
  const score = (r: SimResult) => pBy(r, target) - (Number.isFinite(r.q.p50) ? r.q.p50 : model.start + HORIZON + 10) * 1e-4;
  const title = (id: string) => data.nodes[id]?.title ?? id;
  const units = model.subs.flatMap((s) => s.units.map((u) => ({ id: u.id, sub: s.id })));
  const subOf = Object.fromEntries(units.map((u) => [u.id, u.sub]));

  const mainRes = run({});
  const mainP = pBy(mainRes, target);

  /** Milestone and goal commits from a simulation result. */
  const tail = (branchId: string, r: SimResult): Commit[] => {
    const subs = r.subs.filter((s) => Number.isFinite(s.p50)).sort((a, b) => a.p50 - b.p50);
    const last = r.subs.reduce((a, b) => (b.p50 > a.p50 ? b : a));
    const out: Commit[] = subs.map((s) => ({
      hash: hash(`${branchId}:m:${s.id}`), year: s.p50, kind: 'milestone', subgoal: s.id, bottleneck: s.id === last.id,
      message: `${title(s.id)}: done in half of futures`,
    }));
    for (const s of r.subs.filter((x) => !Number.isFinite(x.p50))) out.push({ hash: hash(`${branchId}:m:${s.id}`), year: model.start + HORIZON, kind: 'milestone', subgoal: s.id, bottleneck: true, message: `${title(s.id)}: not done in half of futures within ${HORIZON} years` });
    out.push({
      hash: hash(`${branchId}:goal`), year: Number.isFinite(r.q.p50) ? r.q.p50 : model.start + HORIZON, kind: 'goal', p: pBy(r, target),
      message: Number.isFinite(r.q.p50) ? `Goal reached in half of futures (${Math.round(pBy(r, target) * 100)}% by ${target})` : `Goal not reached in half of futures within ${HORIZON} years`,
    });
    return out;
  };
  const branch = (b: Omit<Branch, 'p' | 'delta' | 'median' | 'bottleneck' | 'commits'> & { commits: Commit[] }, r: SimResult): Branch => {
    const last = r.subs.reduce((a, c) => (c.p50 > a.p50 ? c : a));
    return { ...b, p: pBy(r, target), delta: (pBy(r, target) - mainP) * 100, median: r.q.p50, bottleneck: last.id, commits: [...b.commits, ...tail(b.id, r)].sort((x, y) => x.year - y.year) };
  };

  // Tracked projects that matter most on main: switch each candidate off.
  const candidates = data.projects
    .map((p) => ({ p, w: model.subs.flatMap((s) => s.units.flatMap((u) => u.projects)).filter((x) => x.key === p.key).reduce((a, x) => a + x.weight * x.success, 0) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 30);
  const critical = candidates
    .map(({ p }) => ({ key: p.key, title: p.title, drop: (mainP - pBy(run({ exclude: [p.key] }), target)) * 100 }))
    .filter((c) => c.drop > 0.05)
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 5);

  const branches: Branch[] = [];
  branches.push(branch({
    id: 'main', name: 'main', kind: 'main', newProjects: 0, starts: [],
    summary: `The ${data.projects.length} tracked projects as they are.`,
    commits: critical.map((c, i) => ({ hash: hash(`main:keep:${c.key}`), year: model.start + 0.4 + 0.7 * i, kind: 'keep', message: `Keep ${c.title} going (−${c.drop.toFixed(1)} pts by ${target} if it stops)` })),
  }, mainRes));

  // best-path: add two projects at a time where they raise the score most.
  const extraUnits: Record<string, number> = {};
  const seq: { unit: string; p: number }[] = [];
  for (let k = 0; k < budget; k += 2) {
    let best = { unit: '', s: -Infinity, r: mainRes };
    for (const u of units) {
      const r = run({ extraUnits: { ...extraUnits, [u.id]: (extraUnits[u.id] ?? 0) + 2 } });
      const s = score(r);
      if (s > best.s) best = { unit: u.id, s, r };
    }
    extraUnits[best.unit] = (extraUnits[best.unit] ?? 0) + 2;
    seq.push({ unit: best.unit, p: pBy(best.r, target) });
  }
  const grouped: { unit: string; count: number; p: number }[] = [];
  for (const s of seq) { const g = grouped[grouped.length - 1]; if (g && g.unit === s.unit) { g.count += 2; g.p = s.p; } else grouped.push({ unit: s.unit, count: 2, p: s.p }); }
  branches.push(branch({
    id: 'best-path', name: 'best-path', kind: 'best', newProjects: budget,
    starts: Object.entries(extraUnits).map(([unit, count]) => ({ unit, subgoal: subOf[unit], count })),
    summary: `${budget} new projects, each pair placed where it raises the chance most.`,
    commits: [
      { hash: hash('best:fork'), year: model.start + 0.15, kind: 'fork', message: 'Branch from main' },
      ...grouped.map((g, i) => ({
        hash: hash(`best:${i}:${g.unit}`), year: model.start + 0.5 + i * 0.75, kind: 'start' as const, subgoal: subOf[g.unit], step: g.unit === subOf[g.unit] ? undefined : g.unit, count: g.count, p: g.p,
        message: `Start ${g.count} projects on ${title(g.unit)}${g.unit !== subOf[g.unit] ? ` (${title(subOf[g.unit])})` : ''} → ${Math.round(g.p * 100)}% by ${target}`,
      })),
    ],
  }, run({ extraUnits })));

  // focus/<sub-goal>: all new projects on one sub-goal.
  for (const s of model.subs) {
    const r = run({ extra: { [s.id]: budget } });
    branches.push(branch({
      id: `focus/${s.id}`, name: `focus/${s.id}`, kind: 'focus', newProjects: budget,
      starts: s.units.map((u) => ({ unit: u.id, subgoal: s.id, count: budget / s.units.length })),
      summary: `All ${budget} new projects on ${title(s.id)}.`,
      commits: [
        { hash: hash(`focus:${s.id}:fork`), year: model.start, kind: 'fork', message: 'Branch from main' },
        { hash: hash(`focus:${s.id}:start`), year: model.start + 1.2, kind: 'start', subgoal: s.id, count: budget, p: pBy(r, target), message: `Start ${budget} projects across ${title(s.id)}` },
      ],
    }, r));
  }

  // balanced: spread evenly.
  const even = Object.fromEntries(model.subs.map((s) => [s.id, budget / model.subs.length]));
  const balancedR = run({ extra: even });
  branches.push(branch({
    id: 'balanced', name: 'balanced', kind: 'balanced', newProjects: budget,
    starts: model.subs.flatMap((s) => s.units.map((u) => ({ unit: u.id, subgoal: s.id, count: even[s.id] / s.units.length }))),
    summary: `${budget} new projects spread evenly over every sub-goal.`,
    commits: [
      { hash: hash('balanced:fork'), year: model.start, kind: 'fork', message: 'Branch from main' },
      ...model.subs.map((s, i) => ({ hash: hash(`balanced:${s.id}`), year: model.start + 0.5 + i * 0.7, kind: 'start' as const, subgoal: s.id, count: even[s.id], message: `Start ${+even[s.id].toFixed(1)} projects on ${title(s.id)}` })),
    ],
  }, balancedR));

  // risk/stall: the tracked projects deliver half as often.
  branches.push(branch({
    id: 'risk/stall', name: 'risk/stall', kind: 'risk', newProjects: 0, starts: [],
    summary: 'No new projects, and the tracked ones deliver half as often.',
    commits: [
      { hash: hash('risk:fork'), year: model.start, kind: 'fork', message: 'Branch from main' },
      { hash: hash('risk:stall'), year: model.start + 1.2, kind: 'risk', message: 'Tracked projects stall: half as many deliver' },
    ],
  }, run({ trackedScale: 0.5 })));

  // Order: main, best-path, then the rest by outcome.
  const [m, b, ...rest] = branches;
  return { target, start: model.start, budget, runs, branches: [m, b, ...rest.sort((x, y) => y.p - x.p)], critical };
}
