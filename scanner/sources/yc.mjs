// Y Combinator companies, from the community-maintained export of YC's public
// directory (https://github.com/yc-oss/api). Filtered by the tags in scan.json.
import { record } from './record.mjs';

export async function search({ http, cfg }) {
  const d = await http.get('yc', 'https://yc-oss.github.io/api/companies/all.json');
  const want = new Set((cfg.tags ?? []).map((t) => t.toLowerCase()));
  const out = [];
  for (const c of Array.isArray(d) ? d : []) {
    const tags = [...(c.tags ?? []), ...(c.industries ?? []), c.subindustry ?? ''].filter(Boolean);
    if (!tags.some((t) => want.has(String(t).toLowerCase()) || String(t).toLowerCase().split(' -> ').some((x) => want.has(x)))) continue;
    out.push(record({
      id: `yc:${c.slug}`,
      source: 'Y Combinator',
      kind: 'startup',
      title: c.name,
      url: c.website || c.url,
      date: c.launched_at ? new Date(c.launched_at * 1000).toISOString() : null,
      summary: [c.one_liner, c.long_description].filter(Boolean).join(' — '),
      orgs: [{ name: c.name, role: 'self', type: 'startup', url: c.website, country: (c.regions ?? [])[0] ?? null, ids: { yc: c.slug } }],
      metrics: { batch: c.batch, status: c.status, team_size: c.team_size, directory: c.url },
      tags: (c.tags ?? []).slice(0, 6),
      query: 'yc-directory',
    }));
  }
  return out;
}
