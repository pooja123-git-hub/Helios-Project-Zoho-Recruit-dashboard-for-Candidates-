// Zoho Recruit API client: reads credentials from .env, refreshes the access
// token when it expires, and pages through whole modules.
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve('.env');

// Settings come from the local .env file and/or real environment variables
// (Vercel, Render, etc. have no .env file). Environment variables win.
export function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  for (const [k, v] of Object.entries(process.env)) if ((k.startsWith('ZOHO_') || k === 'DASHBOARD_PASSWORD') && v) env[k] = v.trim();
  return env;
}

// Persist a single key back into .env without touching the other lines.
// Skipped when there is no .env file or the disk is read-only (e.g. Vercel);
// the refreshed token is still kept in memory.
function saveEnvValue(key, value) {
  try {
    if (!fs.existsSync(ENV_PATH)) return;
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    const re = new RegExp(`^${key}=.*$`, 'm');
    fs.writeFileSync(ENV_PATH, re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`);
  } catch (err) {
    console.warn(`[zoho] could not save ${key} to .env: ${err.message}`);
  }
}

// "zohoapis.com" -> "com", "zohoapis.in" -> "in", etc.
function domains(env) {
  const dc = (env.ZOHO_DATA_CENTER || 'zohoapis.com').replace(/^https?:\/\//, '').replace(/^www\./, '');
  const tld = dc.replace(/^zohoapis\./, '');
  return {
    recruit: `https://recruit.zoho.${tld}/recruit/v2`,
    accounts: `https://accounts.zoho.${tld}`,
  };
}

export class ZohoRecruit {
  constructor() {
    this.env = loadEnv();
    this.urls = domains(this.env);
    this.token = this.env.ZOHO_ACCESS_TOKEN;
    this.refreshing = null;
  }

  async refreshToken() {
    const { ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET } = this.env;
    if (!ZOHO_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
      throw new Error('Access token expired and ZOHO_REFRESH_TOKEN / ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not all set in .env');
    }
    const params = new URLSearchParams({
      refresh_token: ZOHO_REFRESH_TOKEN,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    const res = await fetch(`${this.urls.accounts}/oauth/v2/token?${params}`, { method: 'POST' });
    const body = await res.json();
    if (!body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(body)}`);
    this.token = body.access_token;
    saveEnvValue('ZOHO_ACCESS_TOKEN', this.token);
    saveEnvValue('ZOHO_TOKEN_REFRESHED_AT', new Date().toISOString());
    console.log(`[zoho] access token refreshed at ${new Date().toLocaleString()}`);
  }

  // Refresh once now, then on a fixed schedule, so the token (valid 60 min)
  // never expires mid-fetch. Concurrent callers share the same refresh.
  startAutoRefresh(intervalMs) {
    const run = () => {
      this.refreshing ??= this.refreshToken().finally(() => { this.refreshing = null; });
      return this.refreshing.catch((err) => console.error('[zoho] scheduled refresh failed:', err.message));
    };
    setInterval(run, intervalMs).unref();
    return run();
  }

  async get(pathAndQuery, retried = false) {
    const res = await fetch(`${this.urls.recruit}${pathAndQuery}`, {
      headers: { Authorization: `Zoho-oauthtoken ${this.token}` },
    });
    if (res.status === 401 && !retried) {
      // Share one refresh between concurrent callers.
      this.refreshing ??= this.refreshToken().finally(() => { this.refreshing = null; });
      await this.refreshing;
      return this.get(pathAndQuery, true);
    }
    if (res.status === 204) return { data: [], info: { more_records: false } };
    const text = await res.text();
    if (!res.ok) throw new Error(`Zoho ${res.status} on ${pathAndQuery}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : { data: [], info: { more_records: false } };
  }

  // Pages are fetched a few at a time, which keeps a full sync (~55 pages)
  // well inside hosting time limits.
  async fetchAll(module, onProgress, concurrency = 4) {
    const records = [];
    for (let start = 1; ; start += concurrency) {
      const pages = Array.from({ length: concurrency }, (_, i) => start + i);
      const bodies = await Promise.all(pages.map((p) => this.get(`/${module}?per_page=200&page=${p}`)));
      let more = true;
      for (const body of bodies) {
        records.push(...(body.data || []));
        if (!body.info?.more_records) { more = false; break; }
      }
      onProgress?.(records.length);
      if (!more) break;
    }
    return records;
  }
}
