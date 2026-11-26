/**
 * Monte Carlo scenario simulator. Pure functions, used both at build time (for the
 * page as served) and in the browser (when someone moves a control).
 *
 * The model, per run:
 *  - The goal is reached when every sub-goal is done (the root is AND).
 *  - A sub-goal is done when all of its steps are done, or any one of them if its
 *    logic is OR. A sub-goal without steps is a single unit.
 *  - Each unit's time without the tracked projects is drawn from a lognormal fitted
 *    to the sub-goal's P10–P90 estimate (an assumption written by people in the
 *    sub-goal file). Units of one sub-goal share part of their draw (correlation).
 *  - With probability 1 − p_success the sub-goal can't be done this century.
 *  - Each project succeeds or fails in the run. Successful ones add effort to their
 *    unit; effort shortens the unit's time with diminishing returns:
 *        time × (1 + effort / K) ^ (−elasticity)
 *  - Scenario controls add hypothetical active projects to a sub-goal, scale every
 *    project's chance of success, or switch the tracked projects off.
 */
import type { ProblemData, Project } from './problemData';

export const HORIZON = 75; // years simulated from the start year
const K = 5; // effort that gives the full elasticity effect once (≈ five solid projects)
const UNIT_SIGMA = 0.25; // spread of steps around their sub-goal
/** Expected maximum of n standard normals (Blom's approximation), 0 for n = 1. */
function expectedMax(n: number): number {
  if (n <= 1) return 0;
  const p = (n - 0.375) / (n + 0.25);
  // Inverse normal CDF (Acklam), enough precision for a centring shift.
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (p > 0.97575) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface SimProject { key: string; weight: number; success: number }
export interface SimUnit { id: string; projects: SimProject[] }
export interface SimSub { id: string; title: string; logic: 'AND' | 'OR'; p10: number; p90: number; pSuccess: number; elasticity: number; units: SimUnit[]; tracked: number }
export interface SimModel { start: number; subs: SimSub[]; estimated: boolean }
export interface Scenario {
  includeTracked: boolean;
  /** Scales every project's chance of success (pessimistic / central / optimistic). */
  successScale: number;
  /** Extra hypothetical active projects per sub-goal, spread across its steps. */
  extra: Record<string, number>;
  /** Extra hypothetical active projects on one step (unit id). */
  extraUnits?: Record<string, number>;
  /** Scales only the tracked projects' chance of success (for "if they stall"). */
  trackedScale?: number;
  /** Tracked projects (by key) left out of this scenario. */
  exclude?: string[];
  runs: number;
  seed: number;
}
export interface SimResult {
  start: number;
  runs: number;
  /** P(goal reached by start + i), i = 0..HORIZON */
  cdf: number[];
  /** Arrival-year quantiles (Infinity when not reached within the horizon). */
  q: { p05: number; p25: number; p50: number; p75: number; p90: number; p95: number };
  subs: { id: string; cdf: number[]; p50: number; critical: number }[];
}

/* ------------------------------------------------------------ projects */

/** How much a project adds when it succeeds. Visible, simple, and labelled as such on the page. */
export function projectWeight(p: Project): number {
  const m = p.metrics;
  if (p.kind === 'user') return p.status === 'active' ? 1.5 : p.status === 'done' ? 1.5 : 0.6;
  if (p.kind === 'startup') return 2;
  if (p.kind === 'research') return 1 + (m.amount_usd ? Math.log10(Number(m.amount_usd)) / 6 : 0);
  return 0.8 + Math.log10(1 + Number(m.stars ?? 0)) / 2.5;
}
/** Chance a project delivers what it sets out to. */
export function projectSuccess(p: Project, now = new Date()): number {
  if (p.kind === 'user') return { idea: 0.15, active: 0.4, paused: 0.05, done: 1 }[p.status ?? 'idea'];
  if (p.kind === 'startup') return String(p.metrics.status ?? 'Active') === 'Active' ? 0.3 : 0.05;
  if (p.kind === 'research') return 0.5;
  const pushed = p.metrics.pushed ? new Date(String(p.metrics.pushed)) : null;
  const ageYears = pushed ? (now.getTime() - pushed.getTime()) / 3.15e10 : 3;
  return ageYears < 1 ? 0.6 : ageYears < 2 ? 0.4 : 0.15;
}
/** Ongoing: recently active code, operating startups, recent grants, active people's projects. */
export function isOngoing(p: Project, now = new Date()): boolean {
  if (p.kind === 'user') return p.status === 'active' || p.status === 'idea';
  if (p.kind === 'startup') return String(p.metrics.status ?? 'Active') === 'Active';
  if (p.kind === 'research') return Number(p.metrics.year ?? 0) >= now.getUTCFullYear() - 4;
  const pushed = p.metrics.pushed ? new Date(String(p.metrics.pushed)) : null;
  // Registry entries without a date (LF Energy) are maintained projects by listing.
  if (!pushed) return p.source === 'LF Energy landscape';
  return now.getTime() - pushed.getTime() < 3.15e10 * 1.5;
}

/* ------------------------------------------------------------ model */

export function buildModel(data: ProblemData): SimModel {
  const start = data.meta.start_year ?? new Date().getUTCFullYear();
  let estimated = true;
  const subs: SimSub[] = data.nodes[data.root].children.map((id) => {
    const n = data.nodes[id];
    const e = n.estimate;
    if (!e) estimated = false;
    const sp = (p: Project): SimProject => ({ key: p.key, weight: projectWeight(p), success: projectSuccess(p) });
    const own = (data.projectsOn[id] ?? []).map(sp);
    const units: SimUnit[] = n.children.length
      ? n.children.map((c) => ({ id: c, projects: (data.projectsOn[c] ?? []).map(sp) }))
      : [{ id, projects: [] }];
    // Projects that fit no step help the whole sub-goal: share them across its units.
    for (const p of own) for (const u of units) u.projects.push({ ...p, weight: p.weight / units.length });
    const tracked = (data.projectsOn[id]?.length ?? 0) + n.children.reduce((a, c) => a + (data.projectsOn[c]?.length ?? 0), 0);
    return { id, title: n.title, logic: n.logic, p10: e?.p10 ?? 15, p90: e?.p90 ?? 45, pSuccess: e?.p_success ?? 0.9, elasticity: (n as { elasticity?: number }).elasticity ?? 0.3, units, tracked };
  });
  return { start, subs, estimated };
}

/* ------------------------------------------------------------ simulation */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SCENARIO: Scenario = { includeTracked: true, successScale: 1, extra: {}, runs: 4000, seed: 7 };

export function simulate(model: SimModel, sc: Scenario): SimResult {
  // Common random numbers: baseline draws come from one stream and each step's project
  // draws from its own, so scenarios differ only by what the scenario changes.
  const rand = rng(sc.seed);
  const excluded = new Set(sc.exclude ?? []);
  const trackedScale = sc.trackedScale ?? 1;
  const normal = () => { const u = 1 - rand(), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const goalT = new Float64Array(sc.runs);
  const subT = model.subs.map(() => new Float64Array(sc.runs));
  const critical = model.subs.map(() => 0);
  const params = model.subs.map((s) => {
    const mu = (Math.log(s.p10) + Math.log(s.p90)) / 2;
    const sigma = Math.max(0.05, (Math.log(s.p90) - Math.log(s.p10)) / (2 * 1.2816));
    return { mu, sigma };
  });
  for (let r = 0; r < sc.runs; r++) {
    let worst = 0, worstIdx = 0;
    model.subs.forEach((s, i) => {
      let t: number;
      if (rand() > s.pSuccess) t = Infinity;
      else {
        // The sub-goal's own draw carries its P10–P90 range; steps vary a little around
        // it, centred so that the slowest (AND) or fastest (OR) step still matches it.
        const z = normal();
        const perUnit = (sc.extra[s.id] ?? 0) / s.units.length;
        const shift = (s.logic === 'OR' ? 1 : -1) * UNIT_SIGMA * expectedMax(s.units.length);
        const times = s.units.map((u, ui) => {
          const base = Math.exp(params[i].mu + params[i].sigma * z + UNIT_SIGMA * normal() + shift);
          const pr = rng(sc.seed * 7919 + r * 104729 + i * 1009 + ui * 31);
          let effort = 0;
          // Every project consumes its draw even when left out, so scenarios stay comparable.
          for (const p of u.projects) { const x = pr(); if (sc.includeTracked && !excluded.has(p.key) && x < Math.min(1, p.success * sc.successScale * trackedScale)) effort += p.weight; }
          const extraPerUnit = perUnit + (sc.extraUnits?.[u.id] ?? 0);
          // Hypothetical extra projects: solid, active, average-sized.
          const extra = rng(sc.seed * 15485863 + r * 7907 + i * 101 + ui);
          for (let k = 0; k < Math.floor(extraPerUnit); k++) if (extra() < Math.min(1, 0.45 * sc.successScale)) effort += 1.5;
          const frac = extraPerUnit - Math.floor(extraPerUnit);
          if (frac && extra() < frac && extra() < Math.min(1, 0.45 * sc.successScale)) effort += 1.5;
          return base * Math.pow(1 + effort / K, -s.elasticity);
        });
        t = s.logic === 'OR' ? Math.min(...times) : Math.max(...times);
      }
      subT[i][r] = t;
      if (t >= worst) { worst = t; worstIdx = i; }
    });
    goalT[r] = worst;
    critical[worstIdx]++;
  }
  const cdfOf = (arr: Float64Array) => {
    const sorted = Float64Array.from(arr).sort();
    const out: number[] = [];
    let j = 0;
    for (let y = 0; y <= HORIZON; y++) { while (j < sorted.length && sorted[j] <= y) j++; out.push(j / sorted.length); }
    return { out, sorted };
  };
  const quant = (sorted: Float64Array, p: number) => { const v = sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; return Number.isFinite(v) ? model.start + v : Infinity; };
  const g = cdfOf(goalT);
  return {
    start: model.start,
    runs: sc.runs,
    cdf: g.out,
    q: { p05: quant(g.sorted, 0.05), p25: quant(g.sorted, 0.25), p50: quant(g.sorted, 0.5), p75: quant(g.sorted, 0.75), p90: quant(g.sorted, 0.9), p95: quant(g.sorted, 0.95) },
    subs: model.subs.map((s, i) => { const c = cdfOf(subT[i]); return { id: s.id, cdf: c.out, p50: quant(c.sorted, 0.5), critical: critical[i] / sc.runs }; }),
  };
}

/** P(goal reached by a calendar year). */
export const pBy = (r: SimResult, year: number) => r.cdf[Math.max(0, Math.min(HORIZON, year - r.start))];

/** Percentage-point gain by the target year from adding `n` active projects to each sub-goal in turn. */
export function levers(model: SimModel, sc: Scenario, target: number, n = 5) {
  const base = pBy(simulate(model, { ...sc, runs: 2500 }), target);
  return model.subs
    .map((s) => ({ id: s.id, title: s.title, gain: (pBy(simulate(model, { ...sc, runs: 2500, extra: { ...sc.extra, [s.id]: (sc.extra[s.id] ?? 0) + n } }), target) - base) * 100 }))
    .sort((a, b) => b.gain - a.gain);
}

/* ------------------------------------------------------------ chart */

const fmtYear = (y: number) => (Number.isFinite(y) ? String(Math.round(y)) : 'not within the horizon');

/**
 * Fan chart as an SVG string (DESIGN.md: line on surface, 90% and 50% bands of
 * arrival dates, median in signal). Optional comparison line, direct-labelled.
 */
export function fanChart(r: SimResult, compare: SimResult | null, target: number, { width = 760, height = 300 } = {}): string {
  const L = 44, R = 96, T = 18, B = 34;
  const y0 = r.start, y1 = r.start + 60;
  const X = (y: number) => L + ((Math.min(y1, Math.max(y0, y)) - y0) / (y1 - y0)) * (width - L - R);
  const Y = (p: number) => T + (1 - p) * (height - T - B);
  const band = (a: number, b: number, cls: string) => {
    if (!Number.isFinite(a)) return '';
    const xa = X(a), xb = X(Number.isFinite(b) ? b : y1);
    return `<rect x="${xa.toFixed(1)}" y="${T}" width="${Math.max(0, xb - xa).toFixed(1)}" height="${height - T - B}" class="${cls}"/>`;
  };
  const line = (res: SimResult) => res.cdf.slice(0, 61).map((p, i) => `${X(res.start + i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');
  let g = '';
  for (let y = Math.ceil(y0 / 10) * 10; y <= y1; y += 10) g += `<line x1="${X(y)}" x2="${X(y)}" y1="${T}" y2="${height - B}" class="grid"/><text x="${X(y)}" y="${height - B + 18}" text-anchor="middle" class="tick">${y}</text>`;
  for (const p of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${L}" x2="${width - R}" y1="${Y(p)}" y2="${Y(p)}" class="grid"/><text x="${L - 8}" y="${Y(p) + 4}" text-anchor="end" class="tick">${Math.round(p * 100)}%</text>`;
  const med = r.q.p50;
  const pt = pBy(r, target);
  const last = r.cdf[60];
  const cLast = compare ? compare.cdf[60] : 0;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Chance of reaching the goal by each year, ${y0} to ${y1}. Median arrival ${fmtYear(med)}.">
    ${band(r.q.p05, r.q.p95, 'b90')}${band(r.q.p25, r.q.p75, 'b50')}${g}
    <line x1="${X(target)}" x2="${X(target)}" y1="${T}" y2="${height - B}" class="target"/>
    <text x="${X(target) + 4}" y="${T + 12}" class="tlabel">${target}: ${Math.round(pt * 100)}%</text>
    ${compare ? `<polyline points="${line(compare)}" class="cmp"/><text x="${width - R + 6}" y="${Y(cLast) + (Math.abs(Y(cLast) - Y(last)) < 14 ? 12 : 4)}" class="lab muted">without them</text>` : ''}
    <polyline points="${line(r)}" class="main"/>
    <text x="${width - R + 6}" y="${Y(last) + (compare && Math.abs(Y(cLast) - Y(last)) < 14 ? -4 : 4)}" class="lab">${compare ? 'with them' : 'this scenario'}</text>
    ${Number.isFinite(med) && med <= y1 ? `<line x1="${X(med)}" x2="${X(med)}" y1="${T}" y2="${height - B}" class="median"/><text x="${X(med) + 4}" y="${height - B - 6}" class="mlabel">median ${Math.round(med)}</text>` : ''}
    <line x1="${L}" x2="${width - R}" y1="${height - B}" y2="${height - B}" class="axis"/><line x1="${L}" x2="${L}" y1="${T}" y2="${height - B}" class="axis"/>
  </svg>`;
}

export function headline(r: SimResult): string {
  const { p50, p90 } = r.q;
  if (!Number.isFinite(p50)) return `Under 50% within ${HORIZON} years`;
  return `50% by ${Math.round(p50)}, ${Number.isFinite(p90) ? `90% by ${Math.round(p90)}` : `90% not within ${HORIZON} years`}`;
}
