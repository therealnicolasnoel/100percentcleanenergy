# Keystone reports

An Astro site that publishes reports on the 100 problems. Reports are Markdown files in this repo, so GitHub is where people write, review and publish them, and every change is a commit.

It starts with one problem open: **11. Generate 100% of the world's electricity from clean sources**. Every problem uses the same layouts.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:4321.

## How it connects to GitHub

| Step | Where |
|---|---|
| Write a report | "Publish a report on GitHub" on a problem page opens GitHub's editor with `reports/_template.md` pre-filled in the right folder |
| Propose | Saving the file in GitHub opens a pull request |
| Check | `.github/workflows/check.yml` type-checks and builds. The build fails if frontmatter is invalid, the file is in the wrong folder, or the problem isn't open |
| Review | Pull request review. A reviewer sets `status: reviewed` and adds `reviewers:` |
| Publish | Merging to `main` runs `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages |
| Edit, history, challenge | Every report page links to its file's edit view, its commit history, and a new "Challenge" issue |

### Set up the repo

1. Push this folder to [therealnicolasnoel/100percentcleanenergy](https://github.com/therealnicolasnoel/100percentcleanenergy) (already the default in `src/site.config.ts`).
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Push to `main`. The deploy workflow fills in the repo name, Pages URL and base path itself.
4. Optional: protect `main` and require the **Check reports** workflow.

To point local dev at a fork, copy `.env.example` to `.env` and change `PUBLIC_GITHUB_REPO`.

## Layout

```
reports/
  _template.md                      the report template (sections every report covers)
  11-clean-electricity/
    2026-11-25-where-clean-power-stands.md
src/
  data/problems.ts                  all 100 problems and ACTIVE_PROBLEMS
  content.config.ts                 report frontmatter schema
  layouts/ProblemLayout.astro       universal problem page
  layouts/ReportLayout.astro        universal report page (contents, text, inspector)
  styles/tokens.css                 copied from ../DESIGN.md
```

## Open another problem

1. Add its number to `ACTIVE_PROBLEMS` in `src/data/problems.ts`. Optionally give it a short URL name in `SHORT`.
2. Create `reports/<slug>/`. The slug is the zero-padded number plus the short name, for example `02-malaria`.

That's all. The problem page, report pages and GitHub links come from the shared layouts.

## Report frontmatter

| Field | Required | Notes |
|---|---|---|
| `title`, `summary` | yes | |
| `problem` | yes | Number 1–100; must match the folder |
| `date` | yes | `yyyy-mm-dd` |
| `authors` | yes | List |
| `status` | no | `draft` (default), `generated`, `reviewed`, `challenged` |
| `reviewers` | no | Shown on the Reviewed badge |
| `headline` | no | `value` and `label`; the latest one appears on the problem page |
| `confidence` | no | `low`, `medium`, `high` |
| `sources` | no | `title`, `publisher`, `year`, `url`. With none, the page shows "Unsupported" |
| `updated`, `tags` | no | |

The example report for problem 11 is AI-drafted and marked `generated`. Check its figures before marking it reviewed.
