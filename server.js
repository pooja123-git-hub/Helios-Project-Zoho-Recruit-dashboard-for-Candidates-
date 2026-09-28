// Local server for the Candidate Analytics Dashboard.
//   GET /api/data            -> cached dataset (fetches from Zoho on first call)
//   POST /api/refresh        -> re-fetch everything from Zoho in the background
//   GET /api/status          -> fetch progress
// Everything else is served from ./public.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ZohoRecruit } from './lib/zoho.js';
import { buildDataset } from './lib/transform.js';

const PORT = Number(process.env.PORT) || 3000;
// Raw Zoho records are cached so transform changes apply without a re-fetch.
const CACHE_FILE = path.resolve('data/raw.json');
const AUTO_REFRESH_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_MS = 40 * 60 * 1000;
const PUBLIC_DIR = path.resolve('public');

const zoho = new ZohoRecruit();
let dataset = null;
let status = { state: 'idle', message: '', fetchedAt: null };
let inflight = null;

function build(raw) {
  return { fetchedAt: raw.fetchedAt, ...buildDataset(raw.candidates, raw.applications, raw.jobOpenings) };
}

if (fs.existsSync(CACHE_FILE)) {
  try {
    dataset = build(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
    status.fetchedAt = dataset.fetchedAt;
    console.log(`[cache] loaded ${dataset.records.length} candidates fetched at ${dataset.fetchedAt}`);
  } catch (err) { dataset = null; console.error('[cache] ignored:', err.message); }
}

function refresh() {
  inflight ??= (async () => {
    status = { ...status, state: 'loading', message: 'Fetching candidates…' };
    try {
      const candidates = await zoho.fetchAll('Candidates', (n) => { status.message = `Fetched ${n.toLocaleString()} candidates…`; });
      status.message = 'Fetching applications…';
      const applications = await zoho.fetchAll('Applications');
      status.message = 'Fetching job openings…';
      const jobOpenings = await zoho.fetchAll('Job_Openings');
      const fetchedAt = new Date().toISOString();
      const raw = { fetchedAt, candidates, applications, jobOpenings };
      dataset = build(raw);
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(raw));
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

setInterval(refresh, AUTO_REFRESH_MS).unref();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/data') {
      if (!dataset) await refresh();
      if (!dataset) return sendJson(res, 502, { error: status.message });
      return sendJson(res, 200, { ...dataset, orgId: zoho.env.ZOHO_RECRUIT_URL_ORG || zoho.env.ZOHO_ORG_ID || null });
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      refresh();
      return sendJson(res, 202, status);
    }
    if (url.pathname === '/api/status') return sendJson(res, 200, status);

    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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
}).listen(PORT, '127.0.0.1', async () => {
  console.log(`Candidate Analytics Dashboard -> http://localhost:${PORT}`);
  await zoho.startAutoRefresh(TOKEN_REFRESH_MS);
  if (!dataset) refresh();
});
