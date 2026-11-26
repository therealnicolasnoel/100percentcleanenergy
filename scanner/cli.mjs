#!/usr/bin/env node
// Field scanner command line.
//
//   npm run scan -- 11-clean-electricity            scan one problem
//   npm run scan -- all                             scan every problem with a scan.json
//   npm run scan -- 11-clean-electricity --only=openalex,github --llm --offline
//   npm run scan:init -- 02-malaria                 write a starter scan.json from the tree
//   npm run scan:network -- 11-clean-electricity    rebuild only the relationship map from the last scan
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runScan, initScan, SOURCE_IDS } from './run.mjs';
import { runNetwork } from './network.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split('=')[1];
const targets = args.filter((a) => !a.startsWith('--'));
const cmd = args.includes('--init') ? 'init' : args.includes('--network-only') ? 'network' : 'scan';

const problems = readdirSync(join(ROOT, 'problems'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const chosen = !targets.length || targets.includes('all')
  ? problems.filter((p) => cmd === 'init' || existsSync(join(ROOT, 'problems', p, 'scan.json')))
  : targets;

if (!chosen.length) { console.error('No problems to scan. Add problems/<slug>/scan.json (npm run scan:init -- <slug>).'); process.exit(1); }

const report = [];
for (const slug of chosen) {
  const dir = join(ROOT, 'problems', slug);
  if (!existsSync(join(dir, 'keystone.json'))) { console.error(`${slug}: no keystone.json, skipping`); continue; }
  if (cmd === 'init') {
    if (existsSync(join(dir, 'scan.json')) && !flag('force')) { console.log(`${slug}: scan.json exists (use --force to overwrite)`); continue; }
    console.log(`${slug}: wrote ${initScan(dir)}`);
    continue;
  }
  if (cmd === 'network') {
    console.log(`${slug}: mapping relationships`);
    await runNetwork(dir, { offline: !!flag('offline'), cacheDir: join(ROOT, 'scanner/.cache') });
    continue;
  }
  const only = value('only') ? value('only').split(',') : SOURCE_IDS;
  const llm = !!flag('llm');
  console.log(`${slug}: scanning ${only.join(', ')}${llm ? ' + Claude review' : ''}`);
  const t = Date.now();
  const r = await runScan(dir, { only, llm, offline: !!flag('offline'), cacheDir: join(ROOT, 'scanner/.cache') });
  console.log(`${slug}: ${r.fetched} fetched, ${r.unique} unique, ${r.kept} kept, ${r.orgs} organisations in ${Math.round((Date.now() - t) / 1000)} s`);
  console.log(`  dropped: ${r.dropped.no_context} outside the domain, ${r.dropped.no_step} matching no step${r.llm ? `; Claude dropped ${r.llm.dropped} (~$${r.llm.usd}${r.llm.stopped ? `, stopped: ${r.llm.stopped}` : ''})` : ''}`);
  // The relationship scanner runs on the fresh field data (skip with --no-network).
  if (!flag('no-network')) r.network = (await runNetwork(dir, { offline: !!flag('offline'), cacheDir: join(ROOT, 'scanner/.cache') })).totals;
  report.push({ slug, ...r });
}

// Markdown summary for the pull request the scheduled workflow opens.
if (value('summary')) {
  const lines = ['Automated field scan. Review the changes to `problems/*/field/` before merging.', ''];
  for (const r of report) {
    lines.push(`### ${r.slug}`, '', `${r.kept} items kept from ${r.fetched} fetched (${r.unique} unique), ${r.orgs} organisations.`, '');
    lines.push('| Source | Fetched | Kept |', '|---|---:|---:|', ...Object.entries(r.perSource).map(([k, v]) => `| ${k} | ${v.fetched} | ${v.kept} |`), '');
    if (r.network) lines.push(`Network: ${r.network.organisations} organisations, ${r.network.relationships} relationships (${Object.entries(r.network.by_type).map(([k, v]) => `${v} ${k}`).join(', ')}).`, '');
    if (r.llm) lines.push(`Claude review: ${r.llm.classified} classified, ${r.llm.dropped} dropped, about $${r.llm.usd}${r.llm.stopped ? ` (stopped: ${r.llm.stopped})` : ''}.`, '');
  }
  writeFileSync(value('summary'), lines.join('\n'));
}
