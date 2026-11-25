import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Reports are Markdown files in this repo's reports/ folder, one folder per
 * problem: reports/<problem-slug>/<yyyy-mm-dd>-<name>.md
 *
 * They reach the site through GitHub: a contributor adds or edits a file
 * (in the browser or by pull request), and merging to main rebuilds and
 * deploys the site. Files starting with _ (like _template.md) are ignored.
 */
const reports = defineCollection({
  loader: glob({ pattern: ['**/*.md', '!**/_*.md'], base: './reports' }),
  schema: z.object({
    title: z.string(),
    /** Problem number, 1–100. Must match the folder the file is in. */
    problem: z.number().int().min(1).max(100),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    authors: z.array(z.string()).min(1),
    summary: z.string(),
    /** Review state, shown as a badge. New reports start as "generated" or "draft". */
    status: z.enum(['draft', 'generated', 'reviewed', 'challenged']).default('draft'),
    reviewers: z.array(z.string()).default([]),
    /** Where the problem stands now, as a short headline figure. */
    headline: z
      .object({
        value: z.string(),
        label: z.string(),
      })
      .optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
    sources: z
      .array(
        z.object({
          title: z.string(),
          publisher: z.string().optional(),
          year: z.number().int().optional(),
          url: z.url().optional(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { reports };
