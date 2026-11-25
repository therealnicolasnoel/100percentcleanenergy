import { getCollection, getEntry, type CollectionEntry } from 'astro:content';
import type { Problem } from '../data/problems';

export type MapNode = CollectionEntry<'nodes'>['data'] & { file: string };
export type Actor = CollectionEntry<'network'>['data'] & { file: string };
export type Kind = Actor['kind'];

export const KIND_LABEL: Record<Kind, string> = {
  builder: 'Building',
  research: 'Research',
  investor: 'Investing',
  funder: 'Funding',
  policy: 'Policy',
};
export const KINDS = Object.keys(KIND_LABEL) as Kind[];

export const STATUS_LABEL: Record<MapNode['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  demonstrated: 'Demonstrated',
  solved: 'Solved',
  impossible: 'Impossible',
};

export interface ProblemData {
  folder: string;
  meta: CollectionEntry<'meta'>['data'] & { file: string };
  root: string;
  nodes: Record<string, MapNode>;
  /** Node ids in depth-first order from the root. */
  order: string[];
  parents: Record<string, string[]>;
  actors: Actor[];
  actorsById: Record<string, Actor>;
  /** Actor ids working on each node. */
  actorsOn: Record<string, string[]>;
}

const repoPath = (p?: string) => (p ?? '').replace(/^\.\//, '');

/**
 * Loads a problem's tree map and network from problems/<slug>/. Returns null
 * when the problem has no keystone.json yet. Throws (failing the build and
 * the pull-request check) when files reference ids that don't exist.
 */
export async function getProblemData(problem: Problem): Promise<ProblemData | null> {
  const folder = problem.slug;
  const metaEntry = await getEntry('meta', folder);
  if (!metaEntry) return null;
  const metaFile = repoPath(metaEntry.filePath) || `problems/${folder}/keystone.json`;

  const nodeEntries = (await getCollection('nodes')).filter((e) => e.id.startsWith(`${folder}/`));
  const nodes: Record<string, MapNode> = {};
  for (const e of nodeEntries) {
    const file = repoPath(e.filePath);
    const fileId = e.id.split('/')[1];
    if (e.data.id !== fileId) throw new Error(`${file}: "id" is "${e.data.id}" but the file is named ${fileId}.json. They must match.`);
    nodes[e.data.id] = { ...e.data, file };
  }

  const root = metaEntry.data.root;
  if (!nodes[root]) throw new Error(`${metaFile}: root "${root}" has no file at problems/${folder}/map/nodes/${root}.json.`);

  const parents: Record<string, string[]> = {};
  for (const n of Object.values(nodes)) {
    for (const c of n.children) {
      if (!nodes[c]) throw new Error(`${n.file}: child "${c}" has no file at problems/${folder}/map/nodes/${c}.json.`);
      (parents[c] ??= []).push(n.id);
    }
  }

  const order: string[] = [];
  const visit = (id: string, stack: string[]) => {
    if (stack.includes(id)) throw new Error(`problems/${folder}/map: loop in the tree: ${[...stack, id].join(' → ')}.`);
    if (!order.includes(id)) order.push(id);
    for (const c of nodes[id].children) visit(c, [...stack, id]);
  };
  visit(root, []);
  const orphans = Object.keys(nodes).filter((id) => !order.includes(id));
  if (orphans.length) throw new Error(`problems/${folder}/map: ${orphans.join(', ')} not reachable from the root "${root}". Add them as a child of some step.`);

  const actorEntries = (await getCollection('network')).filter((e) => e.id.startsWith(`${folder}/`));
  const actors: Actor[] = actorEntries
    .map((e) => ({ ...e.data, file: repoPath(e.filePath) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));
  const actorsOn: Record<string, string[]> = {};
  for (const e of actorEntries) {
    const a = actorsById[e.data.id];
    const fileId = e.id.split('/')[1];
    if (a.id !== fileId) throw new Error(`${a.file}: "id" is "${a.id}" but the file is named ${fileId}.json. They must match.`);
    for (const n of a.works_on) {
      if (!nodes[n]) throw new Error(`${a.file}: works_on "${n}" is not a step in problems/${folder}/map/nodes/.`);
      (actorsOn[n] ??= []).push(a.id);
    }
    for (const l of a.links) {
      if (!actorsById[l.to]) throw new Error(`${a.file}: link to "${l.to}" has no file at problems/${folder}/network/${l.to}.json.`);
    }
  }

  return { folder, meta: { ...metaEntry.data, file: metaFile }, root, nodes, order, parents, actors, actorsById, actorsOn };
}

/* ---------- Tree layout (left to right) ---------- */

export const TREE = { colW: 300, cardW: 240, rowH: 108, cardH: 92, pad: 16 };

export interface TreeLayout {
  width: number;
  height: number;
  pos: Record<string, { x: number; y: number; depth: number }>;
  edges: { from: string; to: string; or: boolean; first: boolean }[];
}

/** Leaves stack top to bottom; each parent sits level with the middle of its children. */
export function layoutTree(d: ProblemData): TreeLayout {
  const pos: TreeLayout['pos'] = {};
  let leaf = 0;
  let maxDepth = 0;
  const walk = (id: string, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const n = d.nodes[id];
    let row: number;
    if (!n.children.length) row = leaf++;
    else {
      const rows = n.children.map((c) => walk(c, depth + 1));
      row = (Math.min(...rows) + Math.max(...rows)) / 2;
    }
    pos[id] = { x: TREE.pad + depth * TREE.colW, y: TREE.pad + row * TREE.rowH, depth };
    return row;
  };
  walk(d.root, 0);
  const edges: TreeLayout['edges'] = [];
  for (const id of d.order)
    d.nodes[id].children.forEach((c, i) => edges.push({ from: id, to: c, or: d.nodes[id].logic === 'OR', first: i === 0 }));
  return {
    width: TREE.pad * 2 + maxDepth * TREE.colW + TREE.cardW,
    height: TREE.pad * 2 + Math.max(0, leaf - 1) * TREE.rowH + TREE.cardH,
    pos,
    edges,
  };
}

/* ---------- Network layout (three columns) ---------- */

export const NET = { cardW: 250, stepW: 280, colGap: 80, rowH: 52, cardH: 40, pad: 16 };
const COLUMN: Record<Kind, 0 | 1> = { investor: 0, funder: 0, policy: 0, builder: 1, research: 1 };
export const COLUMN_TITLES = ['Funding and policy', 'Building and research', 'Steps in the tree map'];

export interface NetLayout {
  width: number;
  height: number;
  colX: number[];
  actorPos: Record<string, { x: number; y: number; col: 0 | 1 }>;
  stepPos: Record<string, { x: number; y: number }>;
  steps: string[];
  edges: { from: string; to: string; kind: 'works_on' | 'link'; type?: string; toStep: boolean }[];
}

/**
 * Money and policy on the left, the people doing the work in the middle, the
 * steps they work on on the right. Rows are ordered by the average position
 * of what each organisation connects to, which keeps lines from crossing.
 */
export function layoutNetwork(d: ProblemData): NetLayout {
  const steps = d.order.filter((id) => d.actorsOn[id]?.length);
  const colX = [NET.pad, NET.pad + NET.cardW + NET.colGap, NET.pad + 2 * (NET.cardW + NET.colGap)];
  const cols: [string[], string[]] = [[], []];
  for (const a of d.actors) cols[COLUMN[a.kind]].push(a.id);
  const rows = Math.max(steps.length, cols[0].length, cols[1].length, 1);
  const height = NET.pad * 2 + rows * NET.rowH;
  const slot = (i: number, n: number) => NET.pad + ((i + 0.5) * (rows * NET.rowH)) / n - NET.cardH / 2;

  const stepPos: NetLayout['stepPos'] = {};
  steps.forEach((s, i) => (stepPos[s] = { x: colX[2], y: slot(i, steps.length) }));
  const mean = (ys: number[], fallback: number) => (ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : fallback);

  const actorPos: NetLayout['actorPos'] = {};
  const place = (col: 0 | 1, score: (id: string) => number) => {
    const ids = cols[col].sort((a, b) => score(a) - score(b));
    ids.forEach((id, i) => (actorPos[id] = { x: colX[col], y: slot(i, ids.length), col }));
  };
  place(1, (id) => mean(d.actorsById[id].works_on.map((n) => stepPos[n]?.y ?? 0), height));
  place(0, (id) => {
    const a = d.actorsById[id];
    return mean([...a.works_on.map((n) => stepPos[n]?.y ?? 0), ...a.links.map((l) => actorPos[l.to]?.y ?? 0)], height);
  });

  const edges: NetLayout['edges'] = [];
  for (const a of d.actors) {
    for (const n of a.works_on) edges.push({ from: a.id, to: n, kind: 'works_on', toStep: true });
    for (const l of a.links) edges.push({ from: a.id, to: l.to, kind: 'link', type: l.type, toStep: false });
  }
  return { width: colX[2] + NET.stepW + NET.pad, height, colX, actorPos, stepPos, steps, edges };
}
