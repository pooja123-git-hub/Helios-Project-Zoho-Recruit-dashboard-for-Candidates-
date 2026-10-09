/* Candidate Dashboard — client.
 * One page: pick a date range, see candidates by status (Fresh / In Progress)
 * and by call status in it, and list them. Records come from /api/data. */
'use strict';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('en-IN');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const addDays = (iso, d) => { const t = new Date(`${iso}T00:00:00`); t.setDate(t.getDate() + d); return t.toLocaleDateString('en-CA'); };
const dayLabel = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');

// ---------- state ----------
// Days covered by each date button, counting today.
const PERIODS = { today: { label: 'Today', days: 1 }, week: { label: 'Last week', days: 7 }, month: { label: 'Last month', days: 30 }, custom: { label: 'Custom' } };
// What the summary tables count. Every table counts the candidates CREATED in
// the chosen dates, so all four tables describe the same set of candidates and
// later edits never move a candidate to another day. Each group counts them by
// `get`; `has` limits it to candidates with that step recorded; `card` is the
// table it sits in. `order` lists the values that always get a row, even at
// zero; without it, every value in the data gets one.
// `col: 1` puts a group in the card's second column.
const GROUPS = {
  status: {
    card: 'status', title: 'candidates', get: (r) => r.progress, order: ['Fresh', 'In Progress', 'Rejected'],
  },
  call: {
    card: 'call', title: 'calls', get: (r) => r.callStatus,
    // Call Status picklist in Zoho (Action After Call section), in its order.
    order: ['Not Picked', 'Contacted', 'Call Rejected', 'Call Interview Scheduled', 'Not Contacted', 'Candidate Rejected Us'],
    labels: { Contacted: 'Picked / Contacted' },
    // Only candidates with a call recorded.
    has: (r) => r.callStatus !== 'Not called yet',
  },
  // Rounds: only candidates with a result recorded for that round.
  assessment: {
    card: 'round', title: 'Assessment round',
    get: (r) => (r.assessmentResult !== 'Not recorded' ? r.assessmentResult : r.assessmentStatus),
    has: (r) => r.assessmentResult !== 'Not recorded' || r.assessmentStatus !== 'Not started',
  },
  technical: {
    card: 'round', title: 'Technical round', get: (r) => r.technicalStatus,
    has: (r) => r.technicalStatus !== 'Not started',
  },
  hr: {
    card: 'round', col: 1, title: 'HR round', get: (r) => r.hrResult,
    has: (r) => r.hrResult !== 'Not recorded',
  },
  final: {
    card: 'round', col: 1, title: 'CEO round', get: (r) => r.finalStatus, // Zoho's Final Status field
    has: (r) => r.finalStatus !== 'Not recorded',
  },
  // Final Decision section in Zoho.
  offer: {
    card: 'final', title: 'Offer stages', get: (r) => r.offerStage,
    order: ['To-be-Offered', 'Offer-Accepted', 'Offer-Declined'],
    has: (r) => r.offerStage !== 'Not recorded',
  },
  result: {
    card: 'final', title: 'Final result', get: (r) => r.hiringResult,
    order: ['Joined', 'Not Joined', 'Rejected'],
    has: (r) => r.hiringResult !== 'Not recorded',
  },
};
const CARDS = ['status', 'call', 'round', 'final'];
let DATA = null;
let period = 'today';
const custom = { from: '', to: '' }; // used when period is 'custom'; a blank end is open
let picked = { group: 'status', value: null }; // the summary row being listed; null = that table's total
const table = { page: 0, sortKey: 'created', sortDir: -1 };

function inPeriod(g) {
  const [from, to] = range();
  return DATA.records.filter((r) => (!g.has || g.has(r)) && (!from || r.created >= from) && (!to || r.created <= to));
}

// [from, to] of the chosen dates, as YYYY-MM-DD.
function range() {
  if (period === 'custom') return [custom.from, custom.to];
  return [addDays(today(), 1 - PERIODS[period].days), today()];
}

// "Today", "Last week", or the custom dates spelled out.
function periodLabel() {
  if (period !== 'custom') return PERIODS[period].label;
  const { from, to } = custom;
  if (from && to) return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
  return from ? `From ${dayLabel(from)}` : to ? `Up to ${dayLabel(to)}` : 'All dates';
}

// ---------- candidate table ----------
const recruitUrl = (id) => (DATA.orgId ? `https://recruit.zoho.com/recruit/org${DATA.orgId}/EntityInfo.do?module=Candidates&id=${encodeURIComponent(id)}` : null);
const COLS = [
  { key: 'name', label: 'Name', v: (r) => r.name, html: (r) => (recruitUrl(r.id) ? `<a href="${recruitUrl(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)) },
  { key: 'code', label: 'Candidate ID', v: (r) => r.code },
  { key: 'progress', label: 'Status', v: (r) => r.progress, html: (r) => tag(r.progress) },
  { key: 'created', label: 'Created', v: (r) => r.created, html: (r) => esc(dayLabel(r.created)) },
  { key: 'callDate', label: 'Call Date', v: (r) => r.callDate, html: (r) => (r.callDate ? esc(dayLabel(r.callDate)) : tag('–')) },
  { key: 'callStatus', label: 'Call Status', v: (r) => r.callStatus, html: (r) => tag(r.callStatus, GROUPS.call.labels[r.callStatus] || r.callStatus) },
  { key: 'callRemarks', label: 'Call Remarks', v: (r) => r.callRemarks, html: (r) => (r.callRemarks ? `<span class="clip" title="${esc(r.callRemarks)}">${esc(r.callRemarks)}</span>` : tag('–')) },
  ...['assessment', 'technical', 'hr', 'final', 'offer', 'result'].map((k) => ({
    key: k, label: GROUPS[k].title.replace(' round', '').replace(' stages', ''), v: (r) => (GROUPS[k].has(r) ? GROUPS[k].get(r) : '–'),
    html: (r) => tag(GROUPS[k].has(r) ? GROUPS[k].get(r) : '–'),
  })),
  { key: 'stage', label: 'Stage', v: (r) => r.stage },
  { key: 'source', label: 'Source', v: (r) => r.source },
  { key: 'job', label: 'Job Opening', v: (r) => (r.jobs[0] === 'No job applied' ? '–' : r.jobs.join(', ')), html: (r) => (r.jobs[0] === 'No job applied' ? tag('–') : esc(r.jobs.join(', '))) },
  { key: 'owner', label: 'Owner', v: (r) => r.owner },
];
const PAGE_SIZE = 25;

// Good / bad / waiting colours for result values in the list.
const TONE = {
  Selected: 'good', Pass: 'good', Completed: 'good', Contacted: 'good', Joined: 'good', 'Offer-Accepted': 'good', 'In Progress': 'good', 'Call Interview Scheduled': 'good',
  Rejected: 'bad', 'Not Selected': 'bad', Fail: 'bad', 'Call Rejected': 'bad', 'Candidate Rejected Us': 'bad', 'Not Joined': 'bad', 'Offer-Declined': 'bad',
  'On Hold': 'warn', 'Not Picked': 'warn', 'Not Contacted': 'warn', 'To-be-Offered': 'warn',
};
const EMPTY = new Set(['–', 'Not called yet']);
const tag = (v, label = v) => (EMPTY.has(v) ? `<span class="dim">${esc(label)}</span>` : `<span class="tag ${TONE[v] || ''}">${esc(label)}</span>`);

function drawList(rows) {
  const col = COLS.find((c) => c.key === table.sortKey);
  const sorted = [...rows].sort((a, b) => String(col.v(a) ?? '').localeCompare(String(col.v(b) ?? '')) * table.sortDir);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  table.page = Math.min(table.page, pages - 1);
  const slice = sorted.slice(table.page * PAGE_SIZE, (table.page + 1) * PAGE_SIZE);
  $('#list').innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>${COLS.map((c) => `<th class="sortable" data-k="${c.key}" aria-sort="${c.key === table.sortKey ? (table.sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${slice.map((r) => `<tr>${COLS.map((c) => `<td>${c.html ? c.html(r) : esc(c.v(r) ?? '–')}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${COLS.length}" class="empty">${search ? 'No candidates match your search' : `No candidates for ${esc(periodLabel().toLowerCase())}`}</td></tr>`}</tbody>
    </table></div>
    <div class="table-foot">
      <span>Showing ${fmt(sorted.length ? table.page * PAGE_SIZE + 1 : 0)}–${fmt(Math.min(sorted.length, (table.page + 1) * PAGE_SIZE))} of ${fmt(sorted.length)}</span>
      <span><button class="btn" data-p="-1" ${table.page ? '' : 'disabled'}>‹ Prev</button> <button class="btn" data-p="1" ${table.page < pages - 1 ? '' : 'disabled'}>Next ›</button></span>
    </div>`;
  $('#list').querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    table.sortDir = table.sortKey === th.dataset.k ? -table.sortDir : 1; table.sortKey = th.dataset.k; drawList(rows);
  }));
  $('#list').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { table.page += Number(b.dataset.p); drawList(rows); }));
}

// ---------- page ----------
let shown = []; // rows in the list right now, for Export CSV
let search = ''; // lower-case search text; while set, the list searches every candidate

function render() {
  if (!DATA) return;
  document.querySelectorAll('#period button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === period)));
  $('#customDates').hidden = period !== 'custom';

  // One summary table per card. A single-group card lists its values, then a
  // Total row; the rounds card gives each round a heading row carrying its total.
  // Clicking any row lists those candidates.
  for (const card of CARDS) {
    const groups = Object.entries(GROUPS).filter(([, g]) => g.card === card);
    const section = ([name, g]) => {
      const rows = inPeriod(g);
      const values = g.order || [...new Set(DATA.records.filter(g.has).map(g.get))].sort();
      const counts = new Map(values.map((v) => [v, 0]));
      for (const r of rows) counts.set(g.get(r), (counts.get(g.get(r)) || 0) + 1);
      if (picked.group === name && picked.value && !counts.has(picked.value)) picked.value = null;
      const row = (label, n, value, cls = '') => `<tr class="pick ${cls}${picked.group === name && picked.value === value ? ' on' : ''}" data-g="${name}" data-v="${esc(value ?? '')}" tabindex="0" role="button">
        <td>${esc(label)}</td><td class="num${n ? '' : ' zero'}"><b>${fmt(n)}</b></td></tr>`;
      const valueRows = [...counts].map(([v, n]) => row(g.labels?.[v] || v, n, v)).join('');
      return groups.length > 1 ? row(g.title, rows.length, null, 'sect') + valueRows : valueRows + row('Total', rows.length, null, 'total');
    };
    const cols = [0, 1].map((c) => groups.filter(([, g]) => (g.col || 0) === c)).filter((c) => c.length);
    $(`#summary-${card}`).innerHTML = cols.map((c) => `<table>
      <thead><tr><th>${esc(periodLabel())}</th><th class="num">Record</th></tr></thead><tbody>${c.map(section).join('')}</tbody></table>`).join('');
  }

  const g = GROUPS[picked.group];
  const multi = Object.values(GROUPS).filter((x) => x.card === g.card).length > 1; // card with several sections
  if (search) {
    // Search looks through every candidate, whatever the date or clicked row.
    const words = search.split(/\s+/);
    shown = DATA.records.filter((r) => words.every((w) => r._search.includes(w)));
    $('#listTitle').textContent = `Search results for “${$('#search').value.trim()}” · all dates (${fmt(shown.length)})`;
    $('#exportBtn').disabled = !shown.length;
    return drawList(shown);
  }
  shown = inPeriod(g).filter((r) => !picked.value || g.get(r) === picked.value);
  $('#listTitle').textContent = `${picked.value ? g.labels?.[picked.value] || picked.value : (multi ? g.title : `All ${g.title}`)}${picked.value && multi ? ` (${g.title})` : ''} · ${periodLabel()} (${fmt(shown.length)})`;
  $('#exportBtn').disabled = !shown.length;
  drawList(shown);
}

function pick(e) {
  const tr = e.target.closest('tr.pick');
  if (!tr) return;
  picked = { group: tr.dataset.g, value: tr.dataset.v || null }; table.page = 0; render();
}

function exportCsv() {
  const cols = ['code', 'name', 'progress', 'created', 'updated', 'stage', 'status', 'source', 'owner', 'location', 'jobs', 'callStatus', 'callDate', 'callRemarks', 'assessmentStatus', 'assessmentResult', 'technicalStatus', 'hrResult', 'finalStatus', 'offerStage', 'hiringResult', 'joiningDate'];
  const cell = (v) => { const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...shown.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
  a.download = `${search ? 'search' : picked.group === 'status' ? 'candidates' : picked.group}-${(search || picked.value || 'all').toLowerCase().replace(/\W+/g, '-')}-${period}-${today()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- data ----------
const EXPECTED_SCHEMA = 4; // must match SCHEMA_VERSION in lib/transform.js
function banner(msg) { $('#banner').hidden = !msg; $('#banner').textContent = msg || ''; }

async function load(quiet = false) {
  if (!quiet) $('#main').classList.add('loading');
  try {
    const res = await fetch('/api/data');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (body.schema !== EXPECTED_SCHEMA) {
      throw new Error('The server is running an older version of the dashboard. In the terminal press Ctrl+C, run "npm start" again, then reload this page.');
    }
    DATA = body;
    for (const r of DATA.records) {
      r._search = [r.name, r.code, r.role, r.location, r.source, r.owner, r.jobs.join(' '), r.callRemarks].filter(Boolean).join(' ').toLowerCase();
    }
    if (DATA.orgId) $('#openRecruit').href = `https://recruit.zoho.com/recruit/org${DATA.orgId}/ShowTab.do?module=Candidates`;
    // Every candidate in Zoho Recruit; hover shows when the data was last fetched.
    $('#totalPill').textContent = `Total records: ${fmt(DATA.records.length)}`;
    $('#totalPill').title = `Last synced ${new Date(DATA.fetchedAt).toLocaleString()}`;
    banner('');
    render();
  } catch (err) {
    banner(`Couldn't load candidates: ${err.message}`);
    DATA = null;
  } finally {
    $('#main').classList.remove('loading');
  }
}

// Pick up each background sync without a page reload; skipped while the tab is hidden.
const POLL_MS = 5 * 1000;
setInterval(async () => {
  if (document.hidden || !DATA) return;
  try {
    const s = await (await fetch('/api/status')).json();
    if (s.fetchedAt && s.fetchedAt !== DATA.fetchedAt) await load(true);
  } catch { /* server briefly unreachable; try again next tick */ }
}, POLL_MS);

// ---------- wiring ----------
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { search = e.target.value.trim().toLowerCase(); table.page = 0; render(); }, 250);
});
$('#period').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  period = b.dataset.p; table.page = 0; render();
});
for (const k of ['from', 'to']) {
  $(`#${k}Date`).addEventListener('change', (e) => { custom[k] = e.target.value; table.page = 0; render(); });
}
$('#summaries').addEventListener('click', pick);
$('#summaries').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
$('#exportBtn').addEventListener('click', exportCsv);

load();
