// NSF Awards: US public research grants with amounts. Public domain.
// https://www.research.gov/common/webapi/awardapisearch-v1.htm
import { record } from './record.mjs';

const title = (s) => String(s ?? '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The|For|In|At)\b/g, (w) => w.toLowerCase());

export async function search({ http, queries, cfg, since }) {
  const out = [];
  const fields = 'id,title,abstractText,fundsObligatedAmt,awardeeName,startDate,awardeeCountryCode';
  for (const { query, step } of queries) {
    const url = `https://api.nsf.gov/services/v1/awards.json?keyword=${encodeURIComponent(`"${query}"`)}&printFields=${fields}&rpp=${cfg.per_query ?? 8}&dateStart=${encodeURIComponent(`01/01/${since}`)}`;
    const d = await http.get('nsf', url);
    for (const a of d?.response?.award ?? []) {
      const [m, day, y] = String(a.startDate ?? '').split('/');
      out.push(record({
        id: `nsf:${a.id}`,
        source: 'NSF',
        kind: 'grant',
        title: a.title,
        url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}`,
        date: y ? `${y}-${m}-${day}` : null,
        summary: a.abstractText,
        orgs: [
          a.awardeeName && { name: title(a.awardeeName), role: 'awardee', type: 'research', country: a.awardeeCountryCode ?? 'US' },
          { name: 'U.S. National Science Foundation', role: 'funder', type: 'funder', country: 'US' },
        ],
        metrics: { amount_usd: Number(a.fundsObligatedAmt ?? 0) || null },
        query, step,
      }));
    }
  }
  return out;
}
