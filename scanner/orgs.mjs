// Builds the organisation list from every organisation the kept records mention,
// merging duplicates, and marks the ones already in the curated network.
import { normName } from './text.mjs';

// Name key for merging: "U.S. National Science Foundation" = "National Science Foundation",
// "USDOE Office of Energy Efficiency and Renewable Energy (EERE)" = "Office of Energy Efficiency and Renewable Energy".
function orgKey(name) {
  return normName(String(name ?? '').replace(/\([^)]*\)/g, ' ')).replace(/^(u s|us|usdoe|united states) /, '').trim();
}

const TYPE_PRIORITY = ['startup', 'incubator', 'investor', 'funder', 'company', 'builder', 'policy', 'research', 'nonprofit', 'other'];

export function buildOrgs(records, network, { index = null } = {}) {
  // Union-find over every identifier an organisation is seen with (Wikidata, ROR,
  // GitHub, YC, name), so "seen by name in OSTI" and "seen by ROR id in OpenAlex"
  // end up as one organisation whatever order the records come in.
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const keysOf = (o) => {
    const ids = o.ids ?? {};
    return [ids.wikidata && `wd:${ids.wikidata}`, ids.ror && `ror:${ids.ror}`, ids.github && `gh:${ids.github}`, ids.yc && `yc:${ids.yc}`, `n:${orgKey(o.name)}`].filter(Boolean);
  };
  const mentions = [];
  for (const r of records) for (const o of r.orgs) {
    if (orgKey(o.name).length < 2) continue;
    const keys = keysOf(o);
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (const k of keys.slice(1)) union(keys[0], k);
    mentions.push({ r, o, keys });
  }
  const byKey = new Map();
  for (const { r, o, keys } of mentions) {
    const key = find(keys[0]);
    if (index) index.set(`${r.id}|${o.name}`, key);
    const e = byKey.get(key) ?? { key, names: {}, types: {}, roles: {}, ids: {}, countries: {}, urls: new Set(), records: new Set(), steps: {}, kinds: {}, profile: null };
    e.names[o.name] = (e.names[o.name] ?? 0) + 1;
    e.types[o.type] = (e.types[o.type] ?? 0) + (o.role === 'self' ? 10 : 1);
    e.roles[o.role] = (e.roles[o.role] ?? 0) + 1;
    Object.assign(e.ids, Object.fromEntries(Object.entries(o.ids ?? {}).filter(([, v]) => v)));
    if (o.country) e.countries[o.country] = (e.countries[o.country] ?? 0) + 1;
    if (o.url) e.urls.add(o.url);
    if (o.role === 'self') e.profile = r.id;
    if (!e.records.has(r.id)) {
      e.records.add(r.id);
      e.kinds[r.kind] = (e.kinds[r.kind] ?? 0) + 1;
      for (const st of r.steps) e.steps[st] = (e.steps[st] ?? 0) + 1;
    }
    byKey.set(key, e);
  }
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const netByName = new Map(network.flatMap((a) => [a.name, ...(a.aliases ?? [])].map((n) => [orgKey(n), a.id])));
  const netByHost = new Map(network.filter((a) => a.url).map((a) => [host(a.url), a]));
  // A shared website only counts when the names start the same way (Breakthrough Energy
  // Ventures and Breakthrough Energy Fellows share a domain but are different things).
  const byHost = (name, u) => {
    const a = u ? netByHost.get(host(u)) : null;
    return a && orgKey(a.name).split(' ').slice(0, 3).join(' ') === orgKey(name).split(' ').slice(0, 3).join(' ') ? a.id : null;
  };
  return [...byKey.values()]
    .map((e) => {
      // Prefer a plain variant: "Form Energy" over "Form Energy (United States)".
      const plain = Object.keys(e.names).filter((n) => !/\(.*\)\s*$/.test(n)).sort((a, b) => e.names[b] - e.names[a])[0];
      const name = plain ?? top(e.names).replace(/\s*\([^)]*\)\s*$/, '');
      const type = Object.keys(e.types).sort((a, b) => e.types[b] - e.types[a] || TYPE_PRIORITY.indexOf(a) - TYPE_PRIORITY.indexOf(b))[0];
      const url = [...e.urls][0] ?? null;
      return {
        key: e.key,
        name,
        type,
        roles: e.roles,
        country: top(e.countries),
        url,
        ids: e.ids,
        records: e.records.size,
        record_ids: [...e.records].slice(0, 12),
        profile: e.profile,
        kinds: e.kinds,
        steps: Object.fromEntries(Object.entries(e.steps).sort((a, b) => b[1] - a[1])),
        in_network: netByName.get(orgKey(name)) ?? byHost(name, url) ?? null,
        score: e.records.size + (e.profile ? 3 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}
