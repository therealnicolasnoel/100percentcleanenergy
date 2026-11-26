// Cached, paced HTTP for free official APIs. Adapted from ../map-tool/src/opendata.
// A failing source never throws: it is recorded in health() and returns null.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const UA = 'keystone-scanner/0.1 (open research mapping; +https://github.com/therealnicolasnoel/100percentcleanenergy)';
// Minimum gap between calls per source, in ms. arXiv asks for 3 s between requests.
const GAP = { openalex: 120, arxiv: 3100, github: 2100, hackernews: 150, osti: 300, nsf: 250, wikidata: 600, yc: 0, feeds: 200, ror: 150 };

export class Http {
  constructor({ cacheDir, ttlHours = 24 * 6, offline = false, env = process.env } = {}) {
    this.cacheDir = cacheDir;
    this.ttl = ttlHours * 3600e3;
    this.offline = offline;
    this.env = env;
    this.stats = {};
    this.nextAt = {};
    this.blockedUntil = {};
    if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  }

  stat(source) {
    return (this.stats[source] ??= { calls: 0, ok: 0, cached: 0, errors: 0, skipped: 0, lastError: null });
  }

  health() {
    return Object.fromEntries(Object.entries(this.stats).map(([k, v]) => [k, { ...v }]));
  }

  async get(source, url, { method = 'GET', body, headers = {}, as = 'json' } = {}) {
    const s = this.stat(source);
    const key = createHash('sha1').update(`${method} ${url} ${body ?? ''}`).digest('hex');
    const file = this.cacheDir ? join(this.cacheDir, `${source}-${key}.json`) : null;
    if (file && existsSync(file)) {
      try {
        const c = JSON.parse(readFileSync(file, 'utf8'));
        if (Date.now() - c.t < this.ttl) { s.cached++; return c.d; }
      } catch {}
    }
    if (this.offline) { s.skipped++; return null; }
    if ((this.blockedUntil[source] ?? 0) > Date.now()) { s.skipped++; return null; }
    const wait = Math.max(0, (this.nextAt[source] ?? 0) - Date.now());
    this.nextAt[source] = Date.now() + wait + (GAP[source] ?? 200);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    s.calls++;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method, body, headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(45000) });
        if (res.status === 429 || res.status === 403 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          const reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
          const waitMs = retryAfter ? retryAfter * 1000 : reset ? Math.max(0, reset * 1000 - Date.now()) + 1000 : 5000 * (attempt + 1);
          if (attempt < 2 && waitMs <= 65000) { await new Promise((r) => setTimeout(r, waitMs)); continue; }
          this.blockedUntil[source] = Date.now() + 5 * 60e3;
          s.errors++;
          s.lastError = `${res.status} ${res.statusText}${source === 'github' ? ' (set GITHUB_TOKEN for a higher limit)' : ''}${source === 'openalex' ? ' (set OPENALEX_API_KEY)' : ''}`;
          return null;
        }
        if (!res.ok) { s.errors++; s.lastError = `${res.status} ${res.statusText}`; return null; }
        const d = as === 'json' ? await res.json() : await res.text();
        s.ok++;
        if (file) writeFileSync(file, JSON.stringify({ t: Date.now(), d }));
        return d;
      } catch (e) {
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        s.errors++;
        s.lastError = e.name === 'TimeoutError' ? 'timeout' : e.message;
        return null;
      }
    }
    return null;
  }
}
