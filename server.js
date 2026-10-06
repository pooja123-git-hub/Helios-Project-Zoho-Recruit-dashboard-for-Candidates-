// Local server for the Candidate Analytics Dashboard.
//   GET /api/data            -> cached dataset (fetches from Zoho on first call)
//   POST /api/refresh        -> re-fetch everything from Zoho in the background
//   GET /api/status          -> sync state; fetchedAt changes whenever the data changed
// Everything else is served from ./public.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ZohoRecruit } from './lib/zoho.js';
import { buildDataset } from './lib/transform.js';

const PORT = Number(process.env.PORT) || 3000;
const HOSTED = Boolean(process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT);
const HOST = process.env.HOST || (HOSTED ? '0.0.0.0' : '127.0.0.1');
// Raw Zoho records are cached so transform changes apply without a re-fetch.
// Hosted platforms have a read-only project folder, so the cache goes to the temp dir there.
const CACHE_FILE = HOSTED ? path.join(os.tmpdir(), 'zoho-raw.json') : path.resolve('data/raw.json');
// Every 5 seconds only the records changed since the last check are fetched
// (one or two small requests); every 30 minutes everything is re-fetched, which
// also drops records deleted in Zoho. Overlapping ticks share the in-flight sync.
const UPDATE_MS = 5 * 1000;
const FULL_REFRESH_MS = 30 * 60 * 1000;
// Hosted platforms may pause timers between requests, so a request for data
// also triggers an update once the last check is this old.
const STALE_MS = 10 * 1000;
// Changes are asked for from slightly before the last check, so clock drift or
// a save landing mid-request is never missed.
const OVERLAP_MS = 2 * 60 * 1000;
const TOKEN_REFRESH_MS = 40 * 60 * 1000;
const PUBLIC_DIR = path.resolve('public');

const zoho = new ZohoRecruit();
let raw = null; // Zoho records as fetched: { fetchedAt, syncedAt, candidates, applications, jobOpenings }
let dataset = null;
// fetchedAt changes only when the data changed, so open pages re-download only then.
let status = { state: 'idle', message: '', fetchedAt: null };
let inflight = null;

function build(raw) {
  return { fetchedAt: raw.fetchedAt, ...buildDataset(raw.candidates, raw.applications, raw.jobOpenings) };
}

if (fs.existsSync(CACHE_FILE)) {
  try {
    raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    dataset = build(raw);
    status.fetchedAt = dataset.fetchedAt;
    console.log(`[cache] loaded ${dataset.records.length} candidates fetched at ${dataset.fetchedAt}`);
  } catch (err) { dataset = null; console.error('[cache] ignored:', err.message); }
}

function refresh() {
  inflight ??= (async () => {
    status = { ...status, state: 'loading', message: 'Fetching candidates…' };
    try {
      const syncedAt = new Date().toISOString();
      const candidates = await zoho.fetchAll('Candidates', (n) => { status.message = `Fetched ${n.toLocaleString()} candidates…`; });
      status.message = 'Fetching applications…';
      const applications = await zoho.fetchAll('Applications');
      status.message = 'Fetching job openings…';
      const jobOpenings = await zoho.fetchAll('Job_Openings');
      const fetchedAt = new Date().toISOString();
      raw = { fetchedAt, syncedAt, candidates, applications, jobOpenings };
      dataset = build(raw);
      saveCache();
      status = { state: 'ready', message: `Loaded ${candidates.length.toLocaleString()} candidates`, fetchedAt };
      console.log(`[zoho] ${candidates.length} candidates, ${applications.length} applications, ${jobOpenings.length} job openings`);
    } catch (err) {
      status = { ...status, state: 'error', message: err.message };
      console.error('[zoho]', err.message);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(raw));
  } catch (err) { console.warn('[cache] not saved:', err.message); }
}

// Replaces changed records by id; new ones go first, like Zoho's newest-first order.
function merge(list, changed) {
  const index = new Map(list.map((r, i) => [r.id, i]));
  const out = [...list];
  const added = [];
  for (const r of changed) {
    if (index.has(r.id)) out[index.get(r.id)] = r;
    else added.push(r);
  }
  return [...added, ...out];
}

// Fetches only what changed in Zoho since the last check; a full refresh when
// there is no data yet.
function update() {
  if (!raw) return refresh();
  inflight ??= (async () => {
    try {
      const startedAt = new Date().toISOString();
      const since = new Date(new Date(raw.syncedAt || raw.fetchedAt) - OVERLAP_MS);
      const candidates = await zoho.fetchAll('Candidates', null, since);
      const applications = await zoho.fetchAll('Applications', null, since);
      // Records re-sent because of the overlap window, but unchanged, are not a change.
      const stamp = (r) => r.Updated_On || r.Modified_Time;
      const seen = new Map([...raw.candidates, ...raw.applications].map((r) => [r.id, stamp(r)]));
      const fresh = candidates.filter((r) => seen.get(r.id) !== stamp(r));
      const freshApps = applications.filter((r) => seen.get(r.id) !== stamp(r));
      raw.syncedAt = startedAt;
      if (fresh.length || freshApps.length) {
        raw = { ...raw, fetchedAt: startedAt, candidates: merge(raw.candidates, fresh), applications: merge(raw.applications, freshApps) };
        dataset = build(raw);
        status = { state: 'ready', message: `Updated ${fresh.length} candidates, ${freshApps.length} applications`, fetchedAt: raw.fetchedAt };
        console.log(`[zoho] ${status.message}`);
        saveCache();
      } else if (status.state === 'error') {
        status = { ...status, state: 'ready', message: '' };
      }
    } catch (err) {
      status = { ...status, state: 'error', message: err.message };
      console.error('[zoho]', err.message);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const isStale = () => !raw || Date.now() - new Date(raw.syncedAt || raw.fetchedAt) > STALE_MS;

setInterval(update, UPDATE_MS).unref();
setInterval(refresh, FULL_REFRESH_MS).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// Optional password: set DASHBOARD_PASSWORD to require a login (any username).
// Strongly recommended whenever the dashboard is reachable from the internet.
function authorized(req) {
  const pass = zoho.env.DASHBOARD_PASSWORD;
  if (!pass) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const given = Buffer.from(value, 'base64').toString().split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Candidate Dashboard", charset="UTF-8"' });
    return res.end('Login required');
  }
  try {
    if (url.pathname === '/api/data') {
      if (!dataset) await refresh();
      else if (isStale()) await update();
      if (!dataset) return sendJson(res, 502, { error: status.message });
      return sendJson(res, 200, { ...dataset, orgId: zoho.env.ZOHO_RECRUIT_URL_ORG || zoho.env.ZOHO_ORG_ID || null });
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      refresh();
      return sendJson(res, 202, status);
    }
    if (url.pathname === '/api/status') {
      // Open pages poll this every 5 s, which keeps the data fresh even where timers are paused.
      if (raw && isStale()) await update();
      return sendJson(res, 200, status);
    }

    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    // no-cache: browsers re-check on every load, so a new deploy shows up without a hard refresh.
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — the dashboard is probably already running at http://localhost:${PORT}.`);
    console.error('Stop the other process, or start on another port: $env:PORT=3001; npm start');
    process.exit(1);
  }
  throw err;
}).listen(PORT, HOST, async () => {
  console.log(`Candidate Analytics Dashboard -> http://localhost:${PORT}`);
  if (HOSTED && !zoho.env.DASHBOARD_PASSWORD) console.warn('[security] DASHBOARD_PASSWORD is not set — anyone with the URL can see candidate data.');
  if (!zoho.env.ZOHO_REFRESH_TOKEN || !zoho.env.ZOHO_CLIENT_ID || !zoho.env.ZOHO_CLIENT_SECRET) console.error('[zoho] Missing ZOHO_REFRESH_TOKEN / ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET — add them to .env or the host environment variables.');
  await zoho.startAutoRefresh(TOKEN_REFRESH_MS);
  if (!dataset) refresh();
});
