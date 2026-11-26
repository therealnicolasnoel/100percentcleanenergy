// Decides which records are about this problem and which tree-map steps they serve.
//
// A record is kept when (1) it names at least one step's terms and (2) it is in the
// problem's domain: it names a context term, or it came from a domain-scoped source
// (an energy industry on Wikidata, a curated feed, a seed list). Records that are in
// the domain but name no step are filed under the root goal.
import { hits, normName } from './text.mjs';

export function matchRecords(records, { steps, root, contextTerms }) {
  const kept = [];
  const dropped = { no_context: 0, no_step: 0 };
  for (const r of records) {
    const text = `${r.title} ${r.summary} ${(r.tags ?? []).join(' ')} ${r.matchText ?? ''}`;
    const ctx = hits(text, contextTerms);
    if (!ctx.length && !r.domainScoped) { dropped.no_context++; continue; }
    const viaSteps = new Set(r.via.map((v) => v.step).filter(Boolean));
    const scored = [];
    for (const s of steps) {
      const h = hits(text, s.terms);
      if (!h.length) continue;
      // Title hits count double; a hit on the step the record was searched for adds half.
      const inTitle = hits(r.title, h).length;
      scored.push({ id: s.id, score: h.length + inTitle + (viaSteps.has(s.id) ? 0.5 : 0), terms: h });
    }
    scored.sort((a, b) => b.score - a.score);
    let assigned = scored.slice(0, 3).filter((s, i) => i === 0 || s.score >= scored[0].score * 0.5);
    if (r.seedSteps?.length) assigned = r.seedSteps.map((id) => ({ id, score: 1, terms: [] }));
    if (!assigned.length) {
      // Investor essays, launches and startup profiles often describe the problem in
      // general terms: keep them under the root goal if they clearly name the domain.
      const general = ['memo', 'launch', 'startup'].includes(r.kind) && new Set(ctx).size >= 3;
      if (!r.domainScoped && !general) { dropped.no_step++; continue; }
      assigned = [{ id: root, score: 0.5, terms: [] }];
    }
    kept.push({
      ...r,
      steps: assigned.map((s) => s.id),
      matched: [...new Set(assigned.flatMap((s) => s.terms))].slice(0, 6),
      relevance: Math.round(assigned[0].score * 10) / 10,
    });
  }
  return { kept, dropped };
}

/** Merge records that are the same thing: same id, same DOI/URL, or same title and year. */
export function dedupe(records) {
  const byKey = new Map();
  const keyOf = (r) => {
    const u = String(r.url ?? '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    return [r.id, u && `url:${u}`, ['paper', 'preprint', 'report'].includes(r.kind) && `t:${normName(r.title)}`].filter(Boolean);
  };
  const out = [];
  for (const r of records) {
    const keys = keyOf(r);
    const existing = keys.map((k) => byKey.get(k)).find(Boolean);
    if (existing) {
      existing.via.push(...r.via);
      existing.domainScoped ||= r.domainScoped;
      if (!existing.summary && r.summary) existing.summary = r.summary;
      if (r.source !== existing.source && !existing.also?.includes(r.source)) (existing.also ??= []).push(r.source);
      for (const o of r.orgs) if (!existing.orgs.some((x) => normName(x.name) === normName(o.name))) existing.orgs.push(o);
      for (const k of keys) byKey.set(k, existing);
      continue;
    }
    const copy = { ...r, via: [...r.via], orgs: [...r.orgs] };
    out.push(copy);
    for (const k of keys) byKey.set(k, copy);
  }
  return out;
}

/** Investors inherit the steps of the companies they back. */
export function propagateLinks(records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of records) {
    if (!r.links?.length) continue;
    const steps = new Set(r.steps);
    for (const l of r.links) for (const s of byId.get(l.to)?.steps ?? []) steps.add(s);
    r.steps = [...steps].slice(0, 6);
  }
}
