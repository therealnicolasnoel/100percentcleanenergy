// The one record shape every source returns.
//
// kind: paper | preprint | report | grant | repo | startup | company | investor |
//       incubator | funder | research_org | memo | news | launch
// orgs: organisations mentioned by the record, with their role in it
//       (author | owner | awardee | sponsor | funder | investor | self).
import { clean, isoDate } from '../text.mjs';

export function record({ id, source, kind, title, url, date, year, summary, orgs = [], metrics = {}, query = null, step = null, links = [], tags = [], domainScoped = false, matchText = '' }) {
  const d = isoDate(date);
  return {
    id,
    source,
    kind,
    title: clean(title, 220),
    url: url || null,
    date: d,
    year: year ?? (d ? Number(d.slice(0, 4)) : null),
    summary: clean(summary, 360),
    orgs: orgs.filter((o) => o && o.name).map((o) => ({ ...o, name: clean(o.name, 120) })),
    metrics: Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined && v !== '')),
    tags,
    links,
    // Set by the pipeline:
    via: query ? [{ query, step }] : [],
    // True when the source only returns records from this problem's domain
    // (a curated feed, an energy industry, a seed list), so no context word is needed.
    domainScoped,
    // Longer text used only for matching (for example a feed item's full article); not saved.
    matchText: clean(matchText, 6000),
  };
}
