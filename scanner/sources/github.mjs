// GitHub: open-source repositories. Uses GITHUB_TOKEN when set (GitHub Actions sets one).
// https://docs.github.com/en/rest/search
import { record } from './record.mjs';

export async function search({ http, queries, cfg, since, env }) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const minStars = cfg.min_stars ?? 5;
  const qs = [
    ...queries.map(({ query, step }) => ({ q: `${query} in:name,description,topics,readme stars:>=${minStars} pushed:>=${since}-01-01`, query, step })),
    ...(cfg.topics ?? []).map((t) => ({ q: `topic:${t} stars:>=${minStars} pushed:>=${since}-01-01`, query: `topic:${t}`, step: null })),
  ];
  const out = [];
  for (const { q, query, step } of qs) {
    const d = await http.get('github', `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${cfg.per_query ?? 12}`, { headers });
    for (const r of d?.items ?? []) {
      if (r.fork || r.archived) continue;
      out.push(record({
        id: `github:${r.full_name.toLowerCase()}`,
        source: 'GitHub',
        kind: 'repo',
        title: r.full_name,
        url: r.html_url,
        date: r.pushed_at,
        summary: [r.description, (r.topics ?? []).join(' ')].filter(Boolean).join(' · '),
        orgs: r.owner.type === 'Organization' ? [{ name: r.owner.login, role: 'owner', type: 'builder', ids: { github: r.owner.login.toLowerCase() } }] : [],
        metrics: { stars: r.stargazers_count, language: r.language },
        tags: r.topics ?? [],
        query, step,
        domainScoped: query.startsWith('topic:'),
      }));
    }
  }
  return out;
}
