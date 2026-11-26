/**
 * Reads the field scanner's output (problems/<slug>/field/*.json, written by
 * `npm run scan`). Returns null for a problem that hasn't been scanned yet.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProblemData, Kind } from './problemData';

export interface FieldOrg { name: string; role: string; type: string; country?: string | null; url?: string | null }
export interface FieldRecord {
  id: string;
  source: string;
  also?: string[];
  kind: string;
  title: string;
  url: string | null;
  date: string | null;
  year: number | null;
  summary: string;
  orgs: FieldOrg[];
  metrics: Record<string, string | number>;
  tags: string[];
  links: { to: string; type: string }[];
  steps: string[];
  matched: string[];
  relevance: number;
  reviewed_by?: string;
}
export interface Organisation {
  key: string;
  name: string;
  type: string;
  roles: Record<string, number>;
  country: string | null;
  url: string | null;
  ids: Record<string, string>;
  records: number;
  record_ids: string[];
  profile: string | null;
  kinds: Record<string, number>;
  steps: Record<string, number>;
  in_network: string | null;
  score: number;
}
export interface FieldSummary {
  generated_at: string;
  since: number;
  totals: { fetched: number; unique: number; kept: number; organisations: number; dropped: { no_context: number; no_step: number } };
  sources: Record<string, { fetched: number; kept: number; calls?: number; ok?: number; cached?: number; errors?: number; lastError?: string | null }>;
  steps: Record<string, Record<string, number>>;
  trends: Record<string, [number, number][] | null>;
  llm: { model: string; classified: number; dropped: number; usd: number; stopped: string | null } | null;
}
export interface Field { summary: FieldSummary; records: FieldRecord[]; orgs: Organisation[] }

/** Record kinds grouped into the columns of the landscape table. */
export const GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: 'research', label: 'Research', kinds: ['paper', 'preprint', 'report'] },
  { id: 'grants', label: 'Grants', kinds: ['grant'] },
  { id: 'code', label: 'Open source', kinds: ['repo'] },
  { id: 'startups', label: 'Startups', kinds: ['startup', 'launch'] },
  { id: 'companies', label: 'Companies', kinds: ['company'] },
  { id: 'capital', label: 'Investors and funders', kinds: ['investor', 'funder'] },
  { id: 'incubators', label: 'Incubators', kinds: ['incubator'] },
  { id: 'memos', label: 'Investor memos', kinds: ['memo'] },
  { id: 'news', label: 'News', kinds: ['news'] },
];
export const KIND_NAME: Record<string, string> = {
  paper: 'Paper', preprint: 'Preprint', report: 'Report', grant: 'Grant', repo: 'Repository', startup: 'Startup', launch: 'Launch',
  company: 'Company', investor: 'Investor', funder: 'Funder', incubator: 'Incubator', memo: 'Investor memo', news: 'News',
};
export const ORG_TYPE_LABEL: Record<string, string> = {
  startup: 'Startups', company: 'Companies', builder: 'Open-source builders', investor: 'Investors', funder: 'Funders',
  incubator: 'Incubators', research: 'Research groups', policy: 'Government and policy', nonprofit: 'Nonprofits', other: 'Other',
};
/** Which network kind an organisation type becomes when promoted to the curated network. */
export const NETWORK_KIND: Record<string, Kind> = {
  startup: 'builder', company: 'builder', builder: 'builder', research: 'research', nonprofit: 'research', other: 'research',
  investor: 'investor', funder: 'funder', incubator: 'incubator', policy: 'policy',
};

export function getField(slug: string): Field | null {
  const dir = join(process.cwd(), 'problems', slug, 'field');
  if (!existsSync(join(dir, 'summary.json'))) return null;
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return { summary: read('summary.json'), records: read('records.json').records, orgs: read('organisations.json').organisations };
}

/** Counts per step and group, rolled up so a sub-goal includes everything below it. */
export function landscape(field: Field, data: ProblemData) {
  const own: Record<string, Record<string, Set<string>>> = {};
  for (const id of data.order) own[id] = Object.fromEntries(GROUPS.map((g) => [g.id, new Set<string>()]));
  const groupOf = Object.fromEntries(GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.id])));
  for (const r of field.records) for (const s of r.steps) if (own[s] && groupOf[r.kind]) own[s][groupOf[r.kind]].add(r.id);
  const rolled: Record<string, Record<string, Set<string>>> = {};
  const roll = (id: string): Record<string, Set<string>> => {
    if (rolled[id]) return rolled[id];
    const acc = Object.fromEntries(GROUPS.map((g) => [g.id, new Set(own[id][g.id])]));
    for (const c of data.nodes[id].children) for (const g of GROUPS) for (const x of roll(c)[g.id]) acc[g.id].add(x);
    return (rolled[id] = acc);
  };
  const rows = data.order.map((id) => {
    const r = roll(id);
    const counts = Object.fromEntries(GROUPS.map((g) => [g.id, r[g.id].size]));
    const ownTotal = GROUPS.reduce((n, g) => n + own[id][g.id].size, 0);
    return { id, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), ownTotal };
  });
  const max = Object.fromEntries(GROUPS.map((g) => [g.id, Math.max(1, ...rows.map((row) => row.counts[g.id]))]));
  // "Little activity": a leaf step with under a third of the median leaf's records.
  const leafTotals = rows.filter((row) => !data.nodes[row.id].children.length).map((row) => row.total).sort((a, b) => a - b);
  const median = leafTotals[Math.floor(leafTotals.length / 2)] ?? 0;
  const quiet = new Set(rows.filter((row) => !data.nodes[row.id].children.length && row.total < median / 3).map((row) => row.id));
  const depth: Record<string, number> = {};
  const walk = (id: string, d: number) => { depth[id] ??= d; for (const c of data.nodes[id].children) walk(c, d + 1); };
  walk(data.root, 0);
  return { rows, max, quiet, depth, median };
}
