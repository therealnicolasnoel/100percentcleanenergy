// Optional second pass with Claude: drops records that only look relevant because
// they share words with a step, and re-assigns steps. Runs only when
// ANTHROPIC_API_KEY (or another Anthropic credential) is available and --llm is set.
//
// Cost control: records go 40 per request at low effort, every decision is cached
// on disk by record id (so a re-run only pays for new records), and the run stops
// when the estimated spend reaches SCAN_LLM_MAX_USD (default 5).
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6 }; // USD per token
const BATCH = 40;

export async function classify(records, { problemTitle, steps, cacheDir, env = process.env, log = console.log }) {
  const maxUsd = Number(env.SCAN_LLM_MAX_USD ?? 5);
  const stepIds = steps.map((s) => s.id);
  const configHash = createHash('sha1').update(JSON.stringify(steps.map((s) => [s.id, s.title]))).digest('hex').slice(0, 10);
  const file = join(cacheDir, `llm-${configHash}.json`);
  mkdirSync(cacheDir, { recursive: true });
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const todo = records.filter((r) => !cache[r.id]);
  const report = { model: MODEL, cached: records.length - todo.length, classified: 0, dropped: 0, usd: 0, stopped: null };

  // The stable part of the prompt goes first and is cached across batches.
  const system = [
    {
      type: 'text',
      text: [
        `You review search results for a research map of one problem: "${problemTitle}".`,
        'The problem is broken into these steps (id: title):',
        ...steps.map((s) => `- ${s.id}: ${s.title}${s.description ? ` — ${s.description}` : ''}`),
        '',
        'For each record decide:',
        '- relevant: true only if the record is substantially about this problem or one of its steps (electricity, not an unrelated field that shares words such as "transmission" in biology or "grid" in computing).',
        '- steps: the 1–3 step ids it most directly serves. Use the root goal only when it is about the problem as a whole.',
        'Judge from the title and summary only. Do not guess facts that are not in them.',
      ].join('\n'),
      cache_control: { type: 'ephemeral' },
    },
  ];
  const schema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            relevant: { type: 'boolean' },
            steps: { type: 'array', items: { type: 'string', enum: stepIds } },
          },
          required: ['id', 'relevant', 'steps'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };

  const client = new Anthropic();
  for (let i = 0; i < todo.length; i += BATCH) {
    if (report.usd >= maxUsd) { report.stopped = `cost cap of $${maxUsd} reached`; break; }
    const batch = todo.slice(i, i + BATCH);
    const lines = batch.map((r) => JSON.stringify({ id: r.id, kind: r.kind, title: r.title, summary: r.summary.slice(0, 280), keyword_steps: r.steps }));
    try {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: `Records (one JSON object per line):\n${lines.join('\n')}` }],
      });
      const u = res.usage;
      report.usd += (u.input_tokens ?? 0) * PRICE.input + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.input * 1.25 + (u.output_tokens ?? 0) * PRICE.output;
      if (res.stop_reason === 'refusal') { log(`  llm: batch ${i / BATCH + 1} declined; keeping keyword matches`); continue; }
      const text = res.content.find((b) => b.type === 'text')?.text;
      const parsed = text ? JSON.parse(text) : { results: [] };
      for (const x of parsed.results ?? []) cache[x.id] = { relevant: x.relevant, steps: x.steps.filter((s) => stepIds.includes(s)) };
      report.classified += batch.length;
      writeFileSync(file, JSON.stringify(cache));
      log(`  llm: ${Math.min(i + BATCH, todo.length)}/${todo.length} classified, ~$${report.usd.toFixed(2)}`);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) { report.stopped = 'no valid Anthropic credentials'; break; }
      if (e instanceof Anthropic.RateLimitError) { report.stopped = 'rate limited'; break; }
      if (e instanceof Anthropic.APIError) { log(`  llm: API error ${e.status}: ${e.message}`); continue; }
      if (e instanceof SyntaxError) { log('  llm: could not parse a batch; keeping keyword matches'); continue; }
      throw e;
    }
  }

  const out = [];
  for (const r of records) {
    const c = cache[r.id];
    if (!c) { out.push(r); continue; }
    if (!c.relevant) { report.dropped++; continue; }
    out.push({ ...r, steps: c.steps.length ? c.steps : r.steps, reviewed_by: 'claude' });
  }
  report.usd = Math.round(report.usd * 100) / 100;
  return { records: out, report };
}
