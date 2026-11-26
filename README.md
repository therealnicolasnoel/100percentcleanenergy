# Keystone reports

An Astro site that publishes reports on the 100 problems, plus a **tree map** that breaks each problem into the steps it needs, a **network map** of who is building, researching, investing, funding and regulating each step, and a **state of the field** page filled by an automated scanner (papers, repositories, startups, companies, investors, incubators, grants, investor memos and news, mapped to the steps). Everything is a file in this repo, so GitHub is where people write, review and publish it, and every change is a commit.

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
  scan.json                  what the field scanner searches for, per step
  field/                     scanner output (generated; reviewed through pull requests)
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

Each problem has four pages, all from shared layouts: `/problems/<slug>/` (overview and reports), `/problems/<slug>/map/`, `/problems/<slug>/network/` and `/problems/<slug>/field/`.

## Open another problem

1. Add its number to `ACTIVE_PROBLEMS` in `src/data/problems.ts`. Optionally give it a short URL name in `SHORT`.
2. Create `problems/<slug>/`. The slug is the zero-padded number plus the short name, for example `02-malaria`.
3. For the tree map and network, add `keystone.json` and a root step. Until then those pages show a "Start it on GitHub" button.
4. For the field scan, run `npm run scan:init -- <slug>`, replace the generated terms in `scan.json` with the phrases people in that field actually use, then `npm run scan -- <slug>` (or run the "Scan the field" workflow).

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
| `kind` | `builder`, `research`, `investor`, `funder` (public, multilateral, philanthropic), `incubator` or `policy` |
| `works_on` | Ids of tree map steps |
| `links` | `{ "to": "<org id>", "type": "invests_in" \| "funds" \| "partners" \| "supplies" \| "regulates" }` |
| `aliases` | Other names it appears under in papers and databases, so the field scanner can match it |
| `country`, `url`, `sources` | |

The build fails, and so does the pull-request check, if a step or organisation points at an id that doesn't exist, the tree has a loop, or a step can't be reached from the root.

## Field scanner

`scanner/` pulls what is happening around each step of a problem's tree from free, official APIs (no page scraping), maps it to the steps, and writes `problems/<slug>/field/{records,organisations,summary}.json`. The site's "State of the field" tab, the tree map's inspector and the "Add to network" links read those files.

| Source | What it finds |
|---|---|
| OpenAlex | Papers, with their institutions and funders; papers per year for each step |
| arXiv | Preprints |
| OSTI | US Department of Energy reports, with research and sponsor organisations |
| NSF Awards | US research grants, with amounts and awardees |
| GitHub | Open-source repositories and the organisations behind them |
| Hacker News | Startup launches ("Launch HN", "Show HN") and widely discussed posts |
| Y Combinator directory | YC startups, filtered by tag (community export of YC's public directory) |
| Wikidata | Companies in the problem's industries, the investors Wikidata lists for them, incubators and accelerators |
| Feeds | Investor essays and memos, and trade press, from the RSS feeds listed in `scan.json` |
| Seed list | Named investors, incubators and funders from `scan.json`, enriched from Wikidata |

How a record is kept: it must name at least one step's terms and the problem's domain (a `context_terms` word), unless it comes from a domain-scoped source such as an energy industry on Wikidata. It is filed under up to three steps; sub-goals roll up everything below them. Organisations are merged across sources by Wikidata, ROR, GitHub and YC ids and by name, and matched to the curated network by name, `aliases` or website.

```bash
npm run scan -- 11-clean-electricity                 # all sources, about 2–3 minutes
npm run scan -- all                                   # every problem with a scan.json
npm run scan -- 11-clean-electricity --only=openalex,github
npm run scan -- 11-clean-electricity --llm            # add the Claude review (needs ANTHROPIC_API_KEY)
npm run scan:init -- 02-malaria                       # starter scan.json from the tree
```

Responses are cached for six days in `scanner/.cache/`, so re-runs are quick and polite. Optional environment variables: `GITHUB_TOKEN` (higher GitHub search limits; set automatically in Actions), `OPENALEX_API_KEY` or `OPENALEX_EMAIL`, `ANTHROPIC_API_KEY`, `SCAN_LLM_MAX_USD` (default 5).

**Claude review (optional).** With `--llm`, Claude (`claude-opus-5-5`, low effort, structured output) reads each kept item's title and summary, drops the ones that only share words with a step, and re-assigns steps. Decisions are cached, so later runs only pay for new items, and the run stops at the cost cap.

**Every week**, `.github/workflows/scan.yml` re-runs the scan and opens a pull request with the changes, so new findings are reviewed before they're published. Enable "Allow GitHub Actions to create and approve pull requests" in Settings → Actions → General once. Pull requests opened by the workflow don't trigger other workflows, so its own build step is the check.

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
