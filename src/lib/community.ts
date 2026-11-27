/**
 * Projects people run on the platform. Each project is a GitHub issue labelled
 * `project` (opened from .github/ISSUE_TEMPLATE/project.yml), so GitHub handles
 * accounts, notifications and moderation, and the site reads them at build time:
 *
 *   the issue form      → the project's brief (problem, sub-goal, step, stage, …)
 *   comments            → updates; a comment starting "/join" adds you to the team,
 *                         "/leave" takes you off it
 *   `task` issues       → the project's tasks (the form names the project's number);
 *                         "/take" on a task takes it on, closing it marks it done
 *   label `spam`        → hidden from the site
 *
 * Every issue or comment event rebuilds the site (deploy.yml). Fetching never
 * fails the build: without network or a token the site simply shows no projects.
 * For local work, COMMUNITY_FIXTURE=path/to/file.json reads the same shapes from a file
 * ({ issues: [...], comments: { "<number>": [...] } }).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { site } from '../site.config';

export interface Person { login: string; avatar: string; url: string }
export interface Update { id: number; author: Person; html: string; at: string; url: string }
export interface Task { number: number; title: string; url: string; text: string; skills: string; done: boolean; author: Person; takers: Person[]; at: string }
export type Stage = 'idea' | 'active' | 'paused' | 'done';
export interface CommunityProject {
  number: number;
  title: string;
  /** The issue on GitHub. */
  url: string;
  problem: string;
  subgoal: string;
  step: string | null;
  summary: string;
  why: string;
  stage: Stage;
  lookingFor: string[];
  links: string[];
  author: Person;
  team: Person[];
  tasks: Task[];
  updates: Update[];
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------- fetch */

interface RawUser { login: string; avatar_url: string; html_url: string; type?: string }
interface RawIssue { number: number; title: string; html_url: string; body: string | null; state: 'open' | 'closed'; user: RawUser; assignees?: RawUser[]; labels: ({ name: string } | string)[]; created_at: string; updated_at: string; pull_request?: unknown }
interface RawComment { id: number; user: RawUser; body: string; body_html?: string; html_url: string; created_at: string }
interface Raw { issues: RawIssue[]; comments: Record<string, RawComment[]> }

const API = 'https://api.github.com';

async function api<T>(path: string, token: string | undefined): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: 'application/vnd.github.full+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'keystone-reports-site',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

async function pages<T>(path: string, token: string | undefined, max = 10): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= max; page++) {
    const batch = await api<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function load(): Promise<Raw> {
  const fixture = process.env.COMMUNITY_FIXTURE;
  if (fixture) {
    const f = fixture.startsWith('/') ? fixture : join(process.cwd(), fixture);
    if (!existsSync(f)) { console.warn(`[community] COMMUNITY_FIXTURE ${f} not found`); return { issues: [], comments: {} }; }
    return JSON.parse(readFileSync(f, 'utf8'));
  }
  if (process.env.COMMUNITY_OFFLINE) return { issues: [], comments: {} };
  const token = process.env.GITHUB_TOKEN || undefined;
  const repo = `/repos/${site.repo}`;
  const [projects, tasks] = await Promise.all([
    pages<RawIssue>(`${repo}/issues?labels=project&state=all`, token),
    pages<RawIssue>(`${repo}/issues?labels=task&state=all`, token),
  ]);
  const issues = [...projects, ...tasks].filter((i) => !i.pull_request);
  const comments: Record<string, RawComment[]> = {};
  // Comments are needed for project updates and team, and for "/take" on tasks.
  await Promise.all(issues.map(async (i) => { comments[i.number] = await pages<RawComment>(`${repo}/issues/${i.number}/comments`, token, 3); }));
  return { issues, comments };
}

let cache: Promise<CommunityProject[]> | null = null;

/** All projects on the platform, across problems. Fetched once per build. */
export function getCommunity(): Promise<CommunityProject[]> {
  cache ??= load().then(parse).catch((e) => {
    console.warn(`[community] projects not loaded: ${e instanceof Error ? e.message : e}. The site builds without them.`);
    return [];
  });
  return cache;
}

export async function getCommunityFor(slug: string): Promise<CommunityProject[]> {
  return (await getCommunity()).filter((p) => p.problem === slug);
}

/* ---------------------------------------------------------------- parse */

const labelNames = (i: RawIssue) => i.labels.map((l) => (typeof l === 'string' ? l : l.name));
const person = (u: RawUser): Person => ({ login: u.login, avatar: u.avatar_url, url: u.html_url });
const isBot = (u: RawUser) => u.type === 'Bot' || u.login.endsWith('[bot]');

/** Issue forms write each field as "### Label" followed by the answer. */
export function formFields(body: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = (body ?? '').replace(/\r\n/g, '\n').split(/^### +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const key = (nl < 0 ? part : part.slice(0, nl)).trim().toLowerCase();
    const val = (nl < 0 ? '' : part.slice(nl + 1)).trim();
    out[key] = val === '_No response_' ? '' : val;
  }
  return out;
}
const field = (f: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (f[n] !== undefined) return f[n];
  return '';
};
const cleanTitle = (t: string) => t.replace(/^\s*\[(project|task)\]\s*/i, '').trim() || 'Untitled';
const command = (body: string) => body.trim().split(/\s/)[0]?.toLowerCase() ?? '';
const STAGES: Record<string, Stage> = { idea: 'idea', active: 'active', paused: 'paused', done: 'done' };

function parse(raw: Raw): CommunityProject[] {
  const live = raw.issues.filter((i) => !labelNames(i).includes('spam'));
  const byNumber = new Map<number, Task[]>();
  for (const i of live.filter((x) => labelNames(x).includes('task'))) {
    const f = formFields(i.body);
    const n = Number(field(f, 'project').replace(/[^0-9]/g, ''));
    if (!n) continue;
    const takers = new Map<string, Person>();
    for (const a of i.assignees ?? []) takers.set(a.login, person(a));
    for (const c of raw.comments[i.number] ?? []) {
      const cmd = command(c.body);
      if (cmd === '/take') takers.set(c.user.login, person(c.user));
      if (cmd === '/drop') takers.delete(c.user.login);
    }
    const list = byNumber.get(n) ?? [];
    list.push({
      number: i.number, title: cleanTitle(i.title), url: i.html_url, text: field(f, 'what needs doing'), skills: field(f, 'skills that help'),
      done: i.state === 'closed', author: person(i.user), takers: [...takers.values()], at: i.created_at,
    });
    byNumber.set(n, list);
  }

  const out: CommunityProject[] = [];
  for (const i of live.filter((x) => labelNames(x).includes('project'))) {
    const f = formFields(i.body);
    const problem = field(f, 'problem').trim();
    if (!problem) continue;
    const team = new Map<string, Person>([[i.user.login, person(i.user)]]);
    const updates: Update[] = [];
    for (const c of raw.comments[i.number] ?? []) {
      if (isBot(c.user)) continue;
      const cmd = command(c.body);
      if (cmd === '/join') { team.set(c.user.login, person(c.user)); continue; }
      if (cmd === '/leave') { if (c.user.login !== i.user.login) team.delete(c.user.login); continue; }
      updates.push({ id: c.id, author: person(c.user), html: c.body_html ?? `<p>${escape(c.body)}</p>`, at: c.created_at, url: c.html_url });
    }
    const tasks = (byNumber.get(i.number) ?? []).sort((a, b) => Number(a.done) - Number(b.done) || a.number - b.number);
    for (const t of tasks) for (const p of t.takers) team.set(p.login, p);
    const stage = i.state === 'closed' ? 'done' : STAGES[field(f, 'stage').trim().toLowerCase()] ?? 'idea';
    out.push({
      number: i.number, title: cleanTitle(i.title), url: i.html_url, problem,
      subgoal: field(f, 'sub-goal', 'subgoal').trim(), step: field(f, 'step').trim() || null,
      summary: field(f, 'what will it do?'), why: field(f, 'why it matters'), stage,
      lookingFor: field(f, 'looking for').split('\n').map((s) => s.replace(/^[-*]\s*/, '').trim()).filter(Boolean),
      links: [...field(f, 'links').matchAll(/https?:\/\/[^\s)>\]]+/g)].map((m) => m[0]),
      author: person(i.user), team: [...team.values()], tasks, updates,
      createdAt: i.created_at, updatedAt: [i.updated_at, ...updates.map((u) => u.at)].sort().pop()!,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ---------------------------------------------------------------- render */

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text from an issue form as safe HTML: paragraphs, line breaks and links. */
export function textHtml(s: string): string {
  return s.split(/\n{2,}/).filter((p) => p.trim()).map((p) =>
    `<p>${escape(p.trim()).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" rel="noopener nofollow" target="_blank">${u}</a>`).replace(/\n/g, '<br>')}</p>`,
  ).join('');
}

/** Links that open GitHub with the right form filled in. */
export const forms = {
  project: (o: { title?: string; problem: string; subgoal?: string; step?: string; summary?: string; why?: string; stage?: string; looking_for?: string; links?: string }) => {
    const q = new URLSearchParams({ template: 'project.yml', title: `[Project] ${o.title ?? ''}`.trim() });
    for (const k of ['problem', 'subgoal', 'step', 'summary', 'why', 'looking_for', 'links'] as const) if (o[k]) q.set(k, o[k]!);
    if (o.stage) q.set('stage', o.stage);
    return `${site.repoUrl}/issues/new?${q}`;
  },
  task: (project: number, title = '') => `${site.repoUrl}/issues/new?${new URLSearchParams({ template: 'task.yml', title: `[Task] ${title}`.trim(), project: String(project) })}`,
  /** The comment box on an issue. */
  comment: (issueUrl: string) => `${issueUrl}#new_comment_field`,
};

export const STAGE_LABEL: Record<Stage, string> = { idea: 'Idea', active: 'Active', paused: 'Paused', done: 'Done' };
