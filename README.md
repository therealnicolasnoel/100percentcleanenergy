# Keystone reports

An Astro site that publishes reports on the 100 problems, plus a **tree map** that breaks each problem into the steps it needs and a **network map** of who is building, researching, investing, funding and regulating each step. Everything is a file in this repo, so GitHub is where people write, review and publish it, and every change is a commit.

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
| Write | "Publish a report", "Add a step under this" and "Add an organisation" open GitHub's editor with a template from `templates/` in the right folder |
| Propose | Saving the file in GitHub opens a pull request |
| Check | `.github/workflows/check.yml` type-checks and builds. The build fails if a file is invalid, in the wrong folder, or points at an id that doesn't exist |
| Review | Pull request review. A reviewer sets `status: reviewed` and adds `reviewers:` |
| Publish | Merging to `main` runs `.github/workflows/deploy.yml`, which builds and deploys to GitHub Pages |
| Edit, history, challenge | Every report, step and organisation links to its file's edit view, its history and a new issue |

### Set up the repo

1. Push this folder to [therealnicolasnoel/100percentcleanenergy](https://github.com/therealnicolasnoel/100percentcleanenergy) (already the default in `src/site.config.ts`).
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Push to `main`. The deploy workflow fills in the repo name, Pages URL and base path itself.
4. Optional: protect `main` and require the **Check reports** workflow.

To point local dev at a fork, copy `.env.example` to `.env` and change `PUBLIC_GITHUB_REPO`.

## Layout

Everything about a problem lives in one folder:

```
problems/11-clean-electricity/
  keystone.json              title, root step of the tree, review status of map and network
  map/nodes/<id>.json        one file per step of the tree map
  network/<id>.json          one file per organisation
  reports/<date>-<name>.md   reports
templates/                   starting files for a report, a step and an organisation
src/
  data/problems.ts           all 100 problems and ACTIVE_PROBLEMS
  content.config.ts          schemas for all four kinds of file
  lib/problemData.ts         loads and validates a problem's tree and network, lays them out
  layouts/ProblemLayout.astro, layouts/ReportLayout.astro
  components/TreeMap.astro, components/NetworkMap.astro
  styles/tokens.css          copied from ../DESIGN.md
```

Each problem has three pages, all from shared layouts: `/problems/<slug>/` (overview and reports), `/problems/<slug>/map/` and `/problems/<slug>/network/`.

## Open another problem

1. Add its number to `ACTIVE_PROBLEMS` in `src/data/problems.ts`. Optionally give it a short URL name in `SHORT`.
2. Create `problems/<slug>/`. The slug is the zero-padded number plus the short name, for example `02-malaria`.
3. For the tree map and network, add `keystone.json` and a root step. Until then those pages show a "Start it on GitHub" button.

## Tree map steps (`map/nodes/<id>.json`)

The format matches `../github-app`, so a problem folder can also be used there.

| Field | Notes |
|---|---|
| `id` | Lowercase letters, digits, `_`. Must match the file name |
| `title`, `type` | `type` is `goal`, `subgoal` or `action` |
| `logic`, `children` | `AND`: all children needed. `OR`: any one is enough. Children are ids of other step files |
| `status` | `open`, `in_progress`, `demonstrated`, `solved`, `impossible` |
| `bottlenecks` | Any of `Cost`, `Capital`, `Regulation`, `Supply`, `Knowledge`, `Coordination`, `Talent`, `Demand` |
| `blocker` | `true` for the steps that most limit progress |
| `shared_with` | Other problem numbers that need the same step |
| `estimate` | Optional `p10`, `p90` (years) and `p_success` |
| `description`, `sources` | Steps without sources show as "Unsupported" |

## Organisations (`network/<id>.json`)

| Field | Notes |
|---|---|
| `id`, `name`, `description` | `id` must match the file name |
| `kind` | `builder`, `research`, `investor`, `funder` (public, multilateral, philanthropic) or `policy` |
| `works_on` | Ids of tree map steps |
| `links` | `{ "to": "<org id>", "type": "invests_in" \| "funds" \| "partners" \| "supplies" \| "regulates" }` |
| `country`, `url`, `sources` | |

The build fails, and so does the pull-request check, if a step or organisation points at an id that doesn't exist, the tree has a loop, or a step can't be reached from the root.

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

The example report, tree map and network for problem 11 are AI-drafted and marked `generated`. Check figures and organisations' roles before marking them reviewed (`review` in `keystone.json`).
