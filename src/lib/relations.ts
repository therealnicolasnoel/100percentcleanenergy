/**
 * Data and layouts for the "Who's working on it" views:
 *   - a Sankey breakdown (organisation types → groups → all organisations → sub-goals → steps)
 *   - a network map of organisations, their relationships and the steps they work on
 * Both are laid out at build time; the browser only handles hover and selection.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProblemData } from './problemData';
import type { Field } from './field';

/* ---------------------------------------------------------------- groups */

export const GROUP_OF: Record<string, 'building' | 'research' | 'capital' | 'policy'> = {
  startup: 'building', company: 'building', builder: 'building',
  research: 'research', nonprofit: 'research', other: 'policy',
  investor: 'capital', funder: 'capital', incubator: 'capital',
  policy: 'policy',
};
export const GROUP_LABEL = { building: 'Building', research: 'Research', capital: 'Capital and support', policy: 'Policy and other' } as const;
export const GROUP_ORDER = ['building', 'research', 'capital', 'policy'] as const;
export const TYPE_LABEL: Record<string, string> = {
  startup: 'Startups', company: 'Companies', builder: 'Open-source builders', research: 'Research groups', nonprofit: 'Nonprofits',
  investor: 'Investors', funder: 'Funders', incubator: 'Incubators', policy: 'Government and policy', other: 'Other',
};
const TYPE_ORDER = ['startup', 'company', 'builder', 'research', 'nonprofit', 'investor', 'funder', 'incubator', 'policy', 'other'];
// Curated network kinds → organisation types used here.
const CURATED_TYPE: Record<string, string> = { builder: 'company', research: 'research', investor: 'investor', funder: 'funder', incubator: 'incubator', policy: 'policy' };

/* ---------------------------------------------------------------- relations file */

export interface RelNode { key: string; name: string; type: string; in_network: string | null; records: number; url: string | null; country: string | null; wikidata: string | null; description: string | null; degree: number; steps: Record<string, number> }
export interface RelEdge { source: string; target: string; type: string; weight: number; evidence: string[] }
export interface Relations { generated_at: string; totals: { organisations: number; relationships: number; by_type: Record<string, number>; wikidata_resolved: number; from_wikidata: number }; nodes: RelNode[]; edges: RelEdge[]; step_edges: { source: string; step: string; weight: number }[] }

export function getRelations(slug: string): Relations | null {
  const f = join(process.cwd(), 'problems', slug, 'field', 'relations.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

/* ---------------------------------------------------------------- Sankey */

export interface SNode { id: string; col: number; label: string; value: number; x: number; y: number; h: number; side: 'who' | 'what'; caption?: string; quiet?: boolean; step?: string }
export interface SLink { source: string; target: string; value: number; sy: number; ty: number; h: number; side: 'who' | 'what' }
export interface Sankey { width: number; height: number; nodeW: number; nodes: SNode[]; links: SLink[]; total: number; curatedOnly: number }

/**
 * Every organisation counts once. Its unit flows from its type, through its group,
 * into the problem total, then splits across the steps it works on (in proportion to
 * how often it appears on each) and rolls down the tree: sub-goal, then step.
 */
export function buildSankey(field: Field | null, data: ProblemData, { width = 1360, height = 720 } = {}): Sankey {
  // Organisations: everything the field scan found, plus curated ones it didn't.
  const orgs: { name: string; type: string; steps: Record<string, number> }[] = (field?.orgs ?? []).map((o) => ({ name: o.name, type: o.type, steps: o.steps }));
  const found = new Set((field?.orgs ?? []).map((o) => o.in_network).filter(Boolean));
  let curatedOnly = 0;
  for (const a of data.actors) if (!found.has(a.id)) { orgs.push({ name: a.name, type: CURATED_TYPE[a.kind] ?? 'other', steps: Object.fromEntries(a.works_on.map((s) => [s, 1])) }); curatedOnly++; }

  // Depth-1 and depth-2 ancestor of each step.
  const depth: Record<string, number> = {}, d1: Record<string, string> = {}, d2: Record<string, string | null> = {};
  const walk = (id: string, d: number, a1: string | null, a2: string | null) => {
    if (depth[id] !== undefined) return;
    depth[id] = d;
    const n1 = d === 1 ? id : a1, n2 = d === 2 ? id : a2;
    d1[id] = n1 ?? '__whole';
    d2[id] = n2;
    for (const c of data.nodes[id].children) walk(c, d + 1, n1, n2);
  };
  walk(data.root, 0, null, null);

  const val = new Map<string, number>();
  const link = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const tops: Record<string, { name: string; n: number }[]> = {};
  for (const o of orgs) {
    const type = TYPE_LABEL[o.type] ? o.type : 'other';
    const group = GROUP_OF[type];
    const t = `t:${type}`, g = `g:${group}`, all = 'all';
    add(val, t, 1); add(val, g, 1); add(val, all, 1);
    add(link, `${t}>${g}`, 1); add(link, `${g}>${all}`, 1);
    (tops[type] ??= []).push({ name: o.name, n: Object.values(o.steps).reduce((a, b) => a + b, 0) });
    const steps = Object.entries(o.steps).filter(([s]) => data.nodes[s]);
    const sum = steps.reduce((a, [, n]) => a + n, 0);
    const parts = sum ? steps.map(([s, n]) => [s, n / sum] as const) : [[data.root, 1] as const];
    for (const [s, w] of parts) {
      const a1 = depth[s] === 0 ? '__whole' : d1[s];
      add(val, `s:${a1}`, w); add(link, `${all}>s:${a1}`, w);
      const a2 = d2[s];
      if (a2) { add(val, `l:${a2}`, w); add(link, `s:${a1}>l:${a2}`, w); }
    }
  }

  const quietSteps = new Set<string>();
  const leafVals = [...val.entries()].filter(([k]) => k.startsWith('l:')).map(([, v]) => v).sort((a, b) => a - b);
  const med = leafVals[Math.floor(leafVals.length / 2)] ?? 0;
  for (const [k, v] of val) if (k.startsWith('l:') && v < med / 3) quietSteps.add(k.slice(2));

  const nameTops = (type: string) => (tops[type] ?? []).sort((a, b) => b.n - a.n).slice(0, 3).map((t) => t.name).join(', ');
  const order: string[][] = [
    TYPE_ORDER.filter((t) => val.has(`t:${t}`)).map((t) => `t:${t}`),
    GROUP_ORDER.filter((g) => val.has(`g:${g}`)).map((g) => `g:${g}`),
    ['all'],
    [...data.nodes[data.root].children.map((c) => `s:${c}`), 's:__whole'].filter((k) => val.has(k)),
    data.order.filter((id) => depth[id] === 2).map((id) => `l:${id}`).filter((k) => val.has(k)),
  ];
  const labelOf = (k: string) => {
    if (k === 'all') return 'All organisations';
    if (k === 's:__whole') return 'The problem as a whole';
    const [p, id] = [k.slice(0, 2), k.slice(2)];
    if (p === 't:') return TYPE_LABEL[id];
    if (p === 'g:') return GROUP_LABEL[id as keyof typeof GROUP_LABEL];
    return data.nodes[id]?.title ?? id;
  };

  // Geometry. Each node gets a slot at least tall enough for its label, so small
  // nodes never collide; the scale is set so the busiest column fits the height.
  const nodeW = 14;
  const padTop = 56, padBottom = 24;
  const colX = [230, 490, 670, 870, 1010];
  const gap = 10;
  const captionOf = (key: string, ci: number) => {
    const step = key.startsWith('s:') || key.startsWith('l:') ? key.slice(2) : '';
    if (ci === 0) return nameTops(key.slice(2));
    return step && data.nodes[step]?.blocker ? 'Main blocker' : undefined;
  };
  // Room a label needs: beside the node (columns 0 and 4) or above it (1–3).
  const minSlot = (key: string, ci: number) => {
    if (ci === 0) return 44;
    if (ci === 4) return captionOf(key, ci) || quietSteps.has(key.slice(2)) ? 34 : 20;
    return 0;
  };
  const above = (ci: number) => (ci >= 1 && ci <= 3 ? 34 : 0);
  const usable = height - padTop - padBottom;
  const totals = order.map((col) => col.reduce((a, key) => a + (val.get(key) ?? 0), 0));
  let k = Math.min(...order.map((col, i) => (usable - (gap + above(i)) * (col.length - 1)) / Math.max(totals[i], 1)));
  const colHeight = (col: string[], ci: number) => col.reduce((a, key) => a + Math.max((val.get(key) ?? 0) * k, minSlot(key, ci)) + gap + above(ci), 0) - gap;
  // Shrink the scale until every column, with its label room, fits.
  for (let i = 0; i < 40 && Math.max(...order.map(colHeight)) > usable; i++) k *= 0.95;
  const nodes: SNode[] = [];
  order.forEach((col, ci) => {
    let y = padTop + (usable - colHeight(col, ci)) / 2;
    for (const key of col) {
      const v = val.get(key) ?? 0;
      const h = Math.max(1.5, v * k);
      const slot = Math.max(h, minSlot(key, ci));
      y += ci > 0 && col.indexOf(key) > 0 ? above(ci) : 0;
      const step = key.startsWith('s:') || key.startsWith('l:') ? key.slice(2) : undefined;
      nodes.push({
        id: key, col: ci, label: labelOf(key), value: v, x: colX[ci], y: y + (slot - h) / 2, h,
        side: ci <= 2 ? 'who' : 'what',
        caption: captionOf(key, ci),
        quiet: ci === 4 && quietSteps.has(key.slice(2)),
        step: step && step !== '__whole' ? step : undefined,
      });
      y += slot + gap;
    }
  });

  // Links stack inside each node in the order of the node at the other end.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const raw = [...link.entries()].map(([kk, v]) => { const [s, t] = kk.split('>'); return { s: byId.get(s)!, t: byId.get(t)!, v }; }).filter((l) => l.s && l.t);
  const outOff = new Map<string, number>(), inOff = new Map<string, number>();
  const links: SLink[] = [];
  for (const l of raw.sort((a, b) => a.s.col - b.s.col || a.s.y - b.s.y || a.t.y - b.t.y)) {
    const h = l.v * k;
    const so = outOff.get(l.s.id) ?? 0;
    outOff.set(l.s.id, so + h);
    links.push({ source: l.s.id, target: l.t.id, value: l.v, sy: l.s.y + so, ty: 0, h, side: l.t.col <= 2 ? 'who' : 'what' });
  }
  for (const l of [...links].sort((a, b) => byId.get(a.target)!.y - byId.get(b.target)!.y || byId.get(a.source)!.y - byId.get(b.source)!.y)) {
    const t = byId.get(l.target)!;
    const o = inOff.get(t.id) ?? 0;
    inOff.set(t.id, o + l.h);
    l.ty = t.y + o;
  }
  return { width, height, nodeW, nodes, links, total: val.get('all') ?? 0, curatedOnly };
}

/** The band between two nodes as a filled path. */
export function bandPath(l: SLink, s: SNode, t: SNode, nodeW: number): string {
  const x0 = s.x + nodeW, x1 = t.x, xm = (x0 + x1) / 2;
  return `M${x0},${l.sy} C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty} L${x1},${l.ty + l.h} C${xm},${l.ty + l.h} ${xm},${l.sy + l.h} ${x0},${l.sy + l.h} Z`;
}

/* ---------------------------------------------------------------- network layout */

export interface GNode { id: string; kind: 'org' | 'step'; label: string; group?: string; type?: string; r: number; x: number; y: number; curated: boolean; labelled: boolean; org?: RelNode }
export interface GEdge { source: string; target: string; type: string; weight: number; evidence: string[] }
export interface Graph { width: number; height: number; nodes: GNode[]; edges: GEdge[] }

/** Deterministic pseudo-random numbers, so the layout is the same on every build. */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); }

/**
 * Steps of the tree sit on a fixed ring; organisations are pulled towards the steps
 * they work on and the organisations they're connected to, and pushed apart from
 * each other. A few hundred iterations of a plain force simulation.
 */
export function layoutGraph(rel: Relations, data: ProblemData, { width = 1180, height = 900 } = {}): Graph {
  const cx = width / 2, cy = height / 2, R = Math.min(width, height) / 2 - 90;
  // The ring holds the curated sub-goals; links to generated steps roll up to their sub-goal.
  const anchor = (id: string) => { const n = data.nodes[id]; return !n || n.type === 'goal' ? null : n.type === 'step' ? n.parent! : id; };
  const rolled = new Map<string, { source: string; step: string; weight: number }>();
  for (const e of rel.step_edges) {
    const a = anchor(e.step);
    if (!a) continue;
    const k = `${e.source}>${a}`;
    const x = rolled.get(k) ?? { source: e.source, step: a, weight: 0 };
    x.weight += e.weight;
    rolled.set(k, x);
  }
  const stepEdges = [...rolled.values()];
  const stepIds = data.nodes[data.root].children.filter((id) => stepEdges.some((e) => e.step === id));
  const nodes: GNode[] = stepIds.map((id, i) => {
    const a = (i / stepIds.length) * Math.PI * 2 - Math.PI / 2;
    return { id: `step:${id}`, kind: 'step', label: data.nodes[id].title, r: 5, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, curated: false, labelled: true };
  });
  const rand = rng(11);
  const sizeOf = (o: RelNode) => Math.min(16, 4 + Math.sqrt(o.records + o.degree) * 1.1);
  for (const o of rel.nodes) {
    nodes.push({ id: o.key, kind: 'org', label: o.name, group: GROUP_OF[o.type] ?? 'policy', type: o.type, r: sizeOf(o), x: cx + (rand() - 0.5) * R, y: cy + (rand() - 0.5) * R, curated: !!o.in_network, labelled: false, org: o });
  }
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const springs: [number, number, number][] = [];
  for (const e of rel.edges) if (idx.has(e.source) && idx.has(e.target)) springs.push([idx.get(e.source)!, idx.get(e.target)!, Math.min(3, 0.6 + Math.log2(1 + e.weight) * 0.6)]);
  for (const e of stepEdges) if (idx.has(e.source) && idx.has(`step:${e.step}`)) springs.push([idx.get(e.source)!, idx.get(`step:${e.step}`)!, Math.min(2.5, 0.5 + e.weight * 0.15)]);

  const N = nodes.length;
  for (let it = 0; it < 420; it++) {
    const t = 1 - it / 420;
    const fx = new Float64Array(N), fy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (nodes[i].kind === 'step') continue;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const d2 = dx * dx + dy * dy + 0.01;
        const min = nodes[i].r + nodes[j].r + 6;
        const f = 2000 / d2 + (d2 < min * min ? 3 : 0);
        fx[i] += dx * f / Math.sqrt(d2); fy[i] += dy * f / Math.sqrt(d2);
      }
      fx[i] += (cx - nodes[i].x) * 0.004; fy[i] += (cy - nodes[i].y) * 0.004;
    }
    for (const [a, b, w] of springs) {
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - 95) * 0.01 * w;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < N; i++) {
      if (nodes[i].kind === 'step') continue;
      const m = Math.hypot(fx[i], fy[i]), cap = 12 * t + 0.5;
      const s = m > cap ? cap / m : 1;
      nodes[i].x += fx[i] * s; nodes[i].y += fy[i] * s;
      // Keep organisations inside the ring of steps.
      const dx = nodes[i].x - cx, dy = nodes[i].y - cy, d = Math.hypot(dx, dy), lim = R - 24;
      if (d > lim) { nodes[i].x = cx + (dx / d) * lim; nodes[i].y = cy + (dy / d) * lim; }
    }
  }
  // Labels: most important first, skipping any that would overlap one already placed.
  const boxes: [number, number, number, number][] = nodes.filter((n) => n.kind === 'step').map((n) => {
    const w = Math.min(n.label.length, 34) * 6.6;
    return n.x >= cx ? [n.x + 9, n.y - 8, n.x + 9 + w, n.y + 6] : [n.x - 9 - w, n.y - 8, n.x - 9, n.y + 6];
  });
  const hits = (b: [number, number, number, number]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  const orgsByImportance = nodes.filter((n) => n.kind === 'org').sort((a, b) => Number(b.curated) - Number(a.curated) || b.r - a.r);
  for (const n of orgsByImportance) {
    const w = Math.min(n.label.length, 34) * 6;
    const b: [number, number, number, number] = [n.x - w / 2, n.y - n.r - 16, n.x + w / 2, n.y - n.r - 3];
    n.labelled = !hits(b) && (n.curated || n.r >= 6);
    if (n.labelled) boxes.push(b);
  }
  const edges: GEdge[] = rel.edges.filter((e) => idx.has(e.source) && idx.has(e.target));
  for (const e of stepEdges) if (idx.has(e.source) && idx.has(`step:${e.step}`)) edges.push({ source: e.source, target: `step:${e.step}`, type: 'works_on', weight: e.weight, evidence: [] });
  return { width, height, nodes, edges };
}
