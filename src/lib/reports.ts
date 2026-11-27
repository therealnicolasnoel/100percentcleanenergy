import { getCollection, type CollectionEntry } from 'astro:content';
import { problems, type Problem } from '../data/problems';

export type Report = CollectionEntry<'reports'>;

/** The folder a report lives in, e.g. "11-clean-electricity". */
export function reportFolder(r: Report): string {
  return r.id.split('/')[0];
}

/** The last path segment, used in the report URL. */
export function reportSlug(r: Report): string {
  return r.id.split('/').slice(1).join('/');
}

export function reportPath(r: Report): string {
  return `/problems/${reportFolder(r)}/${reportSlug(r)}/`;
}

/** Path of the Markdown file relative to the repo root, for GitHub links. */
export function reportFile(r: Report): string {
  return (r.filePath ?? `problems/${r.id}.md`).replace(/^\.\//, '');
}

/**
 * All reports, newest first. Fails the build if a report sits in the wrong
 * folder or names a problem that isn't open yet, so bad pull requests are
 * caught by the GitHub check before they merge.
 */
export async function getReports(): Promise<Report[]> {
  const all = await getCollection('reports');
  for (const r of all) {
    const p = problems.find((x) => x.number === r.data.problem);
    if (!p) throw new Error(`${reportFile(r)}: problem ${r.data.problem} does not exist.`);
    if (!p.active) throw new Error(`${reportFile(r)}: problem ${p.number} is not open for reports. Add it to ACTIVE_PROBLEMS in src/data/problems.ts.`);
    if (reportFolder(r) !== p.slug) throw new Error(`${reportFile(r)}: says problem ${p.number}, so it belongs in problems/${p.slug}/reports/.`);
    if (['map', 'network', 'field', 'projects'].includes(reportSlug(r))) throw new Error(`${reportFile(r)}: "map", "network", "field" and "projects" are reserved names. Rename the report.`);
    if (!reportSlug(r)) throw new Error(`${reportFile(r)}: reports must be inside problems/${p.slug}/reports/.`);
  }
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getReportsFor(problem: Problem): Promise<Report[]> {
  return (await getReports()).filter((r) => r.data.problem === problem.number);
}
