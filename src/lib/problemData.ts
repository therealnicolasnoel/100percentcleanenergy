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
  incubator: 'Incubating',
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
