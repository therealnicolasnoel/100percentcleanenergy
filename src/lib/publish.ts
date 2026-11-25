import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh, formatDate } from '../site.config';
import type { Problem } from '../data/problems';

const template = readFileSync(join(process.cwd(), 'templates', 'report.md'), 'utf8');

/**
 * A link that opens GitHub's editor with a new report for this problem,
 * pre-filled from reports/_template.md. Saving it there opens a pull request.
 */
export function newReportUrl(problem: Problem, today = new Date()): string {
  const date = formatDate(today);
  const body = template
    .replace(/^problem: .*$/m, `problem: ${problem.number}`)
    .replace(/^date: .*$/m, `date: ${date}`);
  return gh.newFile(`problems/${problem.slug}/reports/${date}-your-report-name.md`, body);
}
