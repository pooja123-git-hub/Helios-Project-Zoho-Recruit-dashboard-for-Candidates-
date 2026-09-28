/* Candidate Dashboard — client.
 * Loads normalized candidate records from /api/data and does all filtering,
 * counting and charting in the browser. Clicking a bar or slice filters by it. */
'use strict';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || Number.isNaN(n) ? '–' : Math.round(n).toLocaleString('en-IN'));
const pct = (a, b) => {
  if (!b) return '–';
  const p = (a / b) * 100;
  if (a && p < 0.1) return '<0.1%';
  return `${p.toFixed(p < 10 && p % 1 ? 1 : 0)}%`;
};
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const addDays = (iso, d) => { const t = new Date(`${iso}T00:00:00`); t.setDate(t.getDate() + d); return t.toLocaleDateString('en-CA'); };
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------- colors ----------
const C = {
  red: '#c62828', grey: '#c9c9d1', text: '#1f1f24', text2: '#5f6068', muted: '#8a8b93', line: '#e7e7ec',
  good: '#1e8e3e', warning: '#e8a100', critical: '#b3261e',
  // Categorical order validated for colour-vision deficiency (adjacent pairs).
  cat: ['#c62828', '#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e87ba4'],
};
const EMPTY_VALUES = new Set(['Not specified', 'Not recorded', 'Not started', 'Not assigned', 'No application', 'No job applied', 'Other', 'Other / unmapped', 'Unassigned', 'No decision']);
const STATUS_TONE = {
  Selected: 'good', Pass: 'good', Completed: 'good', Hired: 'good', Contacted: 'good', Called: 'good', Qualified: 'good', 'Forward-to-Onboarding': 'good', Offered: 'good',
  'On hold': 'warning', 'On Hold': 'warning', Pending: 'warning', Submitted: 'warning', 'Interview-Scheduled': 'warning', 'In Review': 'warning',
  Rejected: 'critical', 'Not Selected': 'critical',
};
// Call Status picklist in Zoho (Action After Call section), in reading order.
const CALL_STATUSES = [
  { value: 'Contacted', label: 'Picked / Contacted', icon: '✅', color: '#1e8e3e', sub: 'Candidate answered' },
  { value: 'Not Picked', label: 'Not Picked', icon: '📵', color: '#e8a100', sub: 'Call not answered' },
  { value: 'Rejected', label: 'Rejected', icon: '❌', color: '#b3261e', sub: 'Rejected on call' },
  { value: 'Invalid Phone Number', label: 'Invalid Number', icon: '⚠️', color: '#ec835a', sub: 'Number not reachable' },
  { value: 'Called (no status)', label: 'Called, no status', icon: '☎️', color: '#2a78d6', sub: 'Call ticked, status blank' },
  { value: 'Not called yet', label: 'Not called yet', icon: '⏳', color: '#c9c9d1', sub: 'No call recorded' },
];
const NOT_CALLED = new Set(['Not called yet']);
const callColor = (v) => CALL_STATUSES.find((s) => s.value === v)?.color || C.grey;
Object.assign(STATUS_TONE, { 'Not Picked': 'warning', 'Invalid Phone Number': 'critical', 'Called (no status)': '' });
EMPTY_VALUES.add('Not called yet');

const toneColor = (v) => ({ good: C.good, warning: C.warning, critical: C.critical }[STATUS_TONE[v]] || (EMPTY_VALUES.has(v) ? C.grey : C.red));
const plainColor = (v) => (EMPTY_VALUES.has(v) ? C.grey : C.red);

// ---------- filters (every Candidate field that holds data) ----------
const yesNo = (b) => (b ? 'Yes' : 'No');
const FILTERS = [
  // shown in the top row
  { key: 'stage', label: 'Candidate Stage', get: (r) => r.stage, main: true },
  { key: 'status', label: 'Candidate Status', get: (r) => r.status, main: true },
  { key: 'source', label: 'Source', get: (r) => r.source, main: true },
  { key: 'owner', label: 'Candidate Owner', get: (r) => r.owner, main: true },
  { key: 'job', label: 'Job Opening', get: (r) => r.jobs, main: true },
  // behind "More filters"
  { key: 'sourceGroup', label: 'Source Channel', get: (r) => r.sourceGroup },
  { key: 'origin', label: 'Origin', get: (r) => r.origin },
  { key: 'appStatus', label: 'Application Status', get: (r) => r.appStatus },
  { key: 'department', label: 'Department', get: (r) => r.department },
  { key: 'country', label: 'Country', get: (r) => r.country },
  { key: 'state', label: 'State', get: (r) => r.state },
  { key: 'city', label: 'City', get: (r) => r.city },
  { key: 'expBand', label: 'Work Experience', get: (r) => r.expBand, order: () => DATA.expBands },
  { key: 'ageBand', label: 'Age', get: (r) => r.ageBand, order: () => DATA.ageBands },
  { key: 'gender', label: 'Gender (from salutation)', get: (r) => r.gender },
  { key: 'callStatus', label: 'Call Status', get: (r) => r.callStatus, order: () => CALL_STATUSES.map((s) => s.value), showZero: true },
  { key: 'assessmentStatus', label: 'Assessment Status', get: (r) => r.assessmentStatus },
  { key: 'assessmentResult', label: 'Assessment Result', get: (r) => r.assessmentResult },
  { key: 'technicalStatus', label: 'Technical Status', get: (r) => r.technicalStatus },
  { key: 'hrResult', label: 'HR Result', get: (r) => r.hrResult },
  { key: 'hiringResult', label: 'Hiring Result', get: (r) => r.hiringResult },
  { key: 'finalStatus', label: 'Final Status', get: (r) => r.finalStatus },
  { key: 'outcome', label: 'Overall Outcome', get: (r) => r.outcome },
  { key: 'testAssignedTo', label: 'Test Assignment', get: (r) => r.testAssignedTo },
  { key: 'assignedTo', label: 'Assigned To', get: (r) => r.assignedTo },
  { key: 'confirmedBy', label: 'Confirmation', get: (r) => r.confirmedBy },
  { key: 'inviteStatus', label: 'Career Page Invite', get: (r) => r.inviteStatus },
  { key: 'tags', label: 'Tag', get: (r) => (r.tags?.length ? r.tags : ['No tag']) },
  { key: 'resume', label: 'Resume Attached', get: (r) => yesNo(r.resume) },
];
const F = Object.fromEntries(FILTERS.map((f) => [f.key, f]));

// ---------- state ----------
let DATA = null;
const active = {};                 // key -> Set of selected values
let dates = { preset: 'all', from: '', to: '' };
let search = '';
let currentTab = 'perDay';
let perDayRange = '14';
let charts = [];

function dateBounds() {
  const t = today();
  if (dates.preset === 'all') return ['', ''];
  if (dates.preset === 'custom') return [dates.from, dates.to];
  return [addDays(t, -Number(dates.preset)), t];
}

function filtered(exceptKey) {
  const [from, to] = dateBounds();
  const q = search.toLowerCase();
  const act = Object.entries(active).filter(([k, s]) => k !== exceptKey && s.size);
  return DATA.records.filter((r) => {
    if (from && r.created < from) return false;
    if (to && r.created > to) return false;
    for (const [k, s] of act) {
      const v = F[k].get(r);
      if (Array.isArray(v) ? !v.some((x) => s.has(x)) : !s.has(v)) return false;
    }
    return !q || r._search.includes(q);
  });
}

function countBy(rows, getter) {
  const m = new Map();
  for (const r of rows) { const v = getter(r); for (const x of Array.isArray(v) ? v : [v]) m.set(x, (m.get(x) || 0) + 1); }
  return m;
}
function sortedItems(map, { top = 12, order } = {}) {
  let items = [...map].map(([name, value]) => ({ name, value }));
  if (order) return order.filter((n) => map.has(n)).map((n) => ({ name: n, value: map.get(n) }));
  items.sort((a, b) => (EMPTY_VALUES.has(a.name) - EMPTY_VALUES.has(b.name)) || (b.value - a.value));
  if (items.length > top) {
    const rest = items.slice(top).reduce((s, d) => s + d.value, 0);
    items = [...items.slice(0, top), { name: 'Other', value: rest }];
  }
  return items;
}

function toggle(key, value) {
  if (!F[key] || value == null || value === 'Other') return;
  const s = active[key] || (active[key] = new Set());
  s.has(value) ? s.delete(value) : s.add(value);
  if (!s.size) delete active[key];
  render();
}

function setDateRange(from, to) {
  dates = { preset: 'custom', from, to };
  $('#datePreset').value = 'custom'; $('#dateFrom').value = from; $('#dateTo').value = to;
  document.querySelectorAll('.f.custom').forEach((el) => { el.hidden = false; });
  render();
}

// ---------- chart builders ----------
function mountChart(el, option, onClick) {
  const chart = echarts.init(el, null, { renderer: 'svg' });
  chart.setOption({ animationDuration: 300, textStyle: { fontFamily: getComputedStyle(document.body).fontFamily }, ...option });
  if (onClick) chart.on('click', onClick);
  charts.push(chart);
  return chart;
}
const tooltip = (extra = {}) => ({
  backgroundColor: '#fff', borderColor: C.line, borderWidth: 1, textStyle: { color: C.text, fontSize: 12.5 },
  extraCssText: 'box-shadow:0 4px 14px rgba(0,0,0,.1);border-radius:8px;', confine: true, ...extra,
});
const tipRow = (color, label, value, sub) => `<div style="display:flex;align-items:center;gap:8px">
  <span style="width:12px;height:3px;border-radius:2px;background:${color}"></span><b style="font-size:14px">${esc(value)}</b>
  <span style="color:${C.text2}">${esc(label)}${sub ? ` · ${esc(sub)}` : ''}</span></div>`;
const dimmed = (key, name) => active[key]?.size && !active[key].has(name);

// Horizontal bars — the default for "count by category".
function hbar(el, items, { key, total, color = plainColor, maxLabel = 26 } = {}) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data for the current filters</div>'; return; }
  el.style.height = `${Math.max(160, items.length * 30 + 30)}px`;
  mountChart(el, {
    grid: { left: 6, right: 60, top: 4, bottom: 4, containLabel: true },
    tooltip: tooltip({ trigger: 'item', formatter: (p) => tipRow(p.color, p.name, fmt(p.value), total ? pct(p.value, total) : '') }),
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', inverse: true, data: items.map((d) => d.name), axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: C.text2, fontSize: 12.5, formatter: (v) => (v.length > maxLabel ? `${v.slice(0, maxLabel - 1)}…` : v) } },
    series: [{
      type: 'bar', barMaxWidth: 18, barCategoryGap: '30%',
      showBackground: true, backgroundStyle: { color: '#f4f4f6', borderRadius: 4 },
      data: items.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: color(d.name), borderRadius: 4, opacity: dimmed(key, d.name) ? 0.3 : 1 } })),
      label: { show: true, position: 'right', color: C.text, fontSize: 12, fontWeight: 600,
        formatter: (p) => (total ? `${fmt(p.value)}  {m|${pct(p.value, total)}}` : fmt(p.value)), rich: { m: { color: C.muted, fontWeight: 400, fontSize: 11.5 } } },
    }],
  }, key ? (p) => toggle(key, p.name) : null);
}

// Vertical bars over time (days or months).
function timeBars(el, labels, values, { onClick, tall } = {}) {
  if (!labels.length) { el.innerHTML = '<div class="empty">No candidates in this range</div>'; return; }
  const max = Math.max(...values);
  mountChart(el, {
    grid: { left: 6, right: 12, top: 28, bottom: 6, containLabel: true },
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(198,40,40,.06)' } },
      formatter: (ps) => `<div style="color:${C.muted};font-size:11.5px;margin-bottom:2px">${esc(ps[0].name)}</div>${tipRow(C.red, 'candidates', fmt(ps[0].value))}` }),
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 11.5, hideOverlap: true } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f0f0f3' } }, axisLabel: { color: C.muted, fontSize: 11 } },
    series: [{
      type: 'bar', data: values, barMaxWidth: 34, itemStyle: { color: C.red, borderRadius: [4, 4, 0, 0] },
      emphasis: { itemStyle: { color: '#8e0000' } },
      label: { show: labels.length <= 31, position: 'top', color: C.text2, fontSize: 11.5, formatter: (p) => (p.value ? fmt(p.value) : '') },
      markPoint: labels.length > 31 ? { symbol: 'pin', symbolSize: 0, label: { show: true, color: C.text, fontWeight: 600, formatter: `Peak ${fmt(max)}`, offset: [0, -6] }, data: [{ type: 'max' }] } : undefined,
    }],
  }, onClick);
  if (tall) el.classList.add('tall');
}

function donut(el, items, { key, total, colors } = {}) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data for the current filters</div>'; return; }
  const colorOf = (n, i) => (EMPTY_VALUES.has(n) ? C.grey : (colors?.[n] || C.cat[i % C.cat.length]));
  mountChart(el, {
    tooltip: tooltip({ trigger: 'item', formatter: (p) => tipRow(p.color, p.name, fmt(p.value), pct(p.value, total)) }),
    legend: { orient: 'vertical', right: 4, top: 'middle', icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: C.text2, fontSize: 12.5 },
      formatter: (n) => { const d = items.find((x) => x.name === n); return `${n}   ${fmt(d?.value)} (${pct(d?.value, total)})`; } },
    series: [{
      type: 'pie', radius: ['50%', '76%'], center: ['30%', '50%'], itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: true, position: 'center', formatter: () => `{v|${fmt(total)}}\n{l|candidates}`, rich: { v: { fontSize: 22, fontWeight: 700, color: C.text }, l: { fontSize: 11.5, color: C.muted } } },
      emphasis: { scale: true, scaleSize: 4, label: { show: true } },
      data: items.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: colorOf(d.name, i), opacity: dimmed(key, d.name) ? 0.3 : 1 } })),
    }],
  }, key ? (p) => toggle(key, p.name) : null);
}

// ---------- candidate table ----------
const recruitUrl = (id) => (DATA.orgId ? `https://recruit.zoho.com/recruit/org${DATA.orgId}/EntityInfo.do?module=Candidates&id=${encodeURIComponent(id)}` : null);
const tagCell = (v) => `<span class="tag ${STATUS_TONE[v] || ''}">${esc(v)}</span>`;
const COLS = {
  code: { label: 'Candidate ID', v: (r) => r.code },
  name: { label: 'Name', v: (r) => r.name, html: (r) => (recruitUrl(r.id) ? `<a href="${recruitUrl(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)) },
  created: { label: 'Created', v: (r) => r.created, html: (r) => esc(dayLabel(r.created)) },
  stage: { label: 'Stage', v: (r) => r.stage, html: (r) => tagCell(r.stage) },
  status: { label: 'Status', v: (r) => r.status },
  source: { label: 'Source', v: (r) => r.source },
  owner: { label: 'Owner', v: (r) => r.owner },
  location: { label: 'Location', v: (r) => r.location || '–' },
  job: { label: 'Job Opening', v: (r) => (r.jobs[0] === 'No job applied' ? '–' : r.jobs.join(', ')) },
  exp: { label: 'Experience', v: (r) => r.expYears, html: (r) => (r.expYears == null ? '–' : r.expYears === 0 ? 'Fresher' : `${+r.expYears.toFixed(1)} yrs`) },
  age: { label: 'Age', v: (r) => r.age, html: (r) => esc(r.age ?? '–') },
  callStatus: { label: 'Call Status', v: (r) => r.callStatus, html: (r) => tagCell(r.callStatus) },
  callDate: { label: 'Call Date', v: (r) => r.callDate, html: (r) => (r.callDate ? esc(dayLabel(r.callDate)) : '–') },
  callRemarks: { label: 'Call Remarks', v: (r) => r.callRemarks },
  interview: { label: 'Interview Scheduled', v: (r) => r.interviewDate, html: (r) => (r.interviewDate ? esc(dayLabel(r.interviewDate)) : '–') },
  assessment: { label: 'Assessment', v: (r) => r.assessmentStatus, html: (r) => `${tagCell(r.assessmentStatus)} ${r.assessmentResult !== 'Not recorded' ? tagCell(r.assessmentResult) : ''}` },
  score: { label: 'Score', v: (r) => r.assessmentScore, html: (r) => esc(r.assessmentScore ?? '–') },
  technical: { label: 'Technical', v: (r) => r.technicalStatus, html: (r) => tagCell(r.technicalStatus) },
  rating: { label: 'Tech Rating', v: (r) => r.technicalRating, html: (r) => esc(r.technicalRating ?? '–') },
  hr: { label: 'HR Result', v: (r) => r.hrResult, html: (r) => tagCell(r.hrResult) },
  hiring: { label: 'Hiring Result', v: (r) => r.hiringResult, html: (r) => tagCell(r.hiringResult) },
  final: { label: 'Final Status', v: (r) => r.finalStatus, html: (r) => tagCell(r.finalStatus) },
  outcome: { label: 'Outcome', v: (r) => r.outcome, html: (r) => tagCell(r.outcome) },
};

function candidateTable(el, rows, colKeys, { pageSize = 25, sortKey = 'created', sortDir = -1 } = {}) {
  const st = { page: 0, sortKey, sortDir };
  const draw = () => {
    const col = COLS[st.sortKey];
    const sorted = [...rows].sort((a, b) => {
      const x = col.v(a), y = col.v(b);
      if (x == null || x === '–') return 1; if (y == null || y === '–') return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * st.sortDir;
    });
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const slice = sorted.slice(st.page * pageSize, (st.page + 1) * pageSize);
    el.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr>${colKeys.map((k) => `<th class="sortable" data-k="${k}" aria-sort="${k === st.sortKey ? (st.sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(COLS[k].label)}</th>`).join('')}</tr></thead>
        <tbody>${slice.map((r) => `<tr>${colKeys.map((k) => `<td>${COLS[k].html ? COLS[k].html(r) : esc(COLS[k].v(r) ?? '–')}</td>`).join('')}</tr>`).join('')
          || `<tr><td colspan="${colKeys.length}" class="empty">No candidates match the current filters</td></tr>`}</tbody>
      </table></div>
      <div class="table-foot">
        <span>Showing ${fmt(sorted.length ? st.page * pageSize + 1 : 0)}–${fmt(Math.min(sorted.length, (st.page + 1) * pageSize))} of ${fmt(sorted.length)}</span>
        <span><button class="btn" data-p="-1" ${st.page ? '' : 'disabled'}>‹ Prev</button> <button class="btn" data-p="1" ${st.page < pages - 1 ? '' : 'disabled'}>Next ›</button></span>
      </div>`;
    el.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
      st.sortDir = st.sortKey === th.dataset.k ? -st.sortDir : 1; st.sortKey = th.dataset.k; draw();
    }));
    el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { st.page += Number(b.dataset.p); draw(); }));
  };
  draw();
}

// ---------- page pieces ----------
const stats = (list) => `<div class="stats">${list.map(([label, value, sub]) =>
  `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`).join('')}</div>`;
const card = (id, title, _hint = '', cls = '') => `<div class="card"><h3>${esc(title)}</h3><div id="${id}" class="card-body ${cls}"></div></div>`;
const note = (text) => `<div class="note">ℹ️ ${esc(text)}</div>`;
const byKey = (rows, key, opts) => sortedItems(countBy(rows, F[key].get), { order: F[key].order?.(), ...opts });

// Chart only the values that were actually filled in; say how many are blank.
function recordedBars(id, rows, key, blank, opts = {}) {
  const filled = rows.filter((r) => F[key].get(r) !== blank);
  hbar(document.querySelector(`#${id}`), byKey(filled, key, opts), { key, total: filled.length, color: toneColor });
}

// ---------- tabs ----------
const TABS = [
  {
    id: 'perDay', icon: '📅', label: 'Candidates Per Day',
    render(p, rows) {
      const t = today();
      const on = (d) => rows.filter((r) => r.created === d).length;
      const within = (n) => rows.filter((r) => r.created > addDays(t, -n)).length;
      const days = countBy(rows, (r) => r.created);
      const avg = days.size ? rows.length / days.size : 0;
      const titles = { 14: 'Last 14 days with data', 30: 'Last 30 days', 90: 'Last 90 days', month: 'Per month (all time)' };
      p.innerHTML = `
        ${stats([['Today', fmt(on(t))], ['Yesterday', fmt(on(addDays(t, -1)))], ['Last 7 days', fmt(within(7))], ['Last 30 days', fmt(within(30))],
          ['Average per active day', avg.toFixed(1), `${fmt(days.size)} days with new candidates`]])}
        <div class="section-title"><span>Candidates created ${perDayRange === 'month' ? 'per month' : 'per day'} (${esc(titles[perDayRange].toLowerCase())})</span>
          <span class="seg">${Object.entries(titles).map(([k, v]) => `<button data-r="${k}" aria-pressed="${k === perDayRange}">${esc(v)}</button>`).join('')}</span></div>
        <div class="card"><div id="perDayChart" class="chart tall"></div></div>
        <div class="section-title"><span>Daily breakdown</span></div>
        <div class="card"><div id="perDayTable"></div></div>`;
      p.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { perDayRange = b.dataset.r; render(); }));

      let keys; let labels; let values;
      if (perDayRange === 'month') {
        const m = countBy(rows, (r) => r.created.slice(0, 7));
        keys = [...m.keys()].sort(); labels = keys.map(monthLabel); values = keys.map((k) => m.get(k));
      } else if (perDayRange === '14') {
        keys = [...days.keys()].sort().slice(-14); labels = keys.map(dayLabel); values = keys.map((k) => days.get(k));
      } else {
        const n = Number(perDayRange);
        keys = Array.from({ length: n }, (_, i) => addDays(t, i - n + 1)); labels = keys.map(dayLabel); values = keys.map((k) => days.get(k) || 0);
      }
      timeBars($('#perDayChart'), labels, values, {
        onClick: (e) => {
          const k = keys[e.dataIndex];
          if (perDayRange === 'month') { const [y, mo] = k.split('-').map(Number); setDateRange(`${k}-01`, new Date(y, mo, 0).toLocaleDateString('en-CA')); }
          else setDateRange(k, k);
        },
      });
      // Breakdown table: most recent first, with the top source for each period.
      const bySource = new Map();
      for (const r of rows) {
        const k = perDayRange === 'month' ? r.created.slice(0, 7) : r.created;
        if (!keys.includes(k)) continue;
        const m = bySource.get(k) || new Map(); m.set(r.source, (m.get(r.source) || 0) + 1); bySource.set(k, m);
      }
      $('#perDayTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>${perDayRange === 'month' ? 'Month' : 'Date'}</th><th>Candidates</th><th>Top source</th></tr></thead><tbody>${
        keys.map((k, i) => ({ k, label: labels[i], v: values[i] })).filter((d) => d.v).reverse().map((d) => {
          const top = [...(bySource.get(d.k) || [])].sort((a, b) => b[1] - a[1])[0];
          return `<tr><td>${esc(d.label)}</td><td class="num">${fmt(d.v)}</td><td>${top ? `${esc(top[0])} (${fmt(top[1])})` : '–'}</td></tr>`;
        }).join('') || '<tr><td colspan="3" class="empty">No candidates in this range</td></tr>'}</tbody></table></div>`;
    },
  },
  {
    id: 'call', icon: '📞', label: 'Call Status',
    render(p, rows) {
      // The tiles and chart ignore the Call Status filter itself, so every status
      // stays visible and the selected one is highlighted; the table respects it.
      const base = filtered('callStatus');
      const counts = countBy(base, F.callStatus.get);
      const called = base.filter((r) => !NOT_CALLED.has(r.callStatus));
      const picked = counts.get('Contacted') || 0;
      const sel = active.callStatus;
      p.innerHTML = `
        <div class="stats">${CALL_STATUSES.map((s) => `
          <button class="stat stat-btn" data-v="${esc(s.value)}" aria-pressed="${Boolean(sel?.has(s.value))}" style="border-top-color:${s.color}">
            <div class="label">${s.icon} ${esc(s.label)}</div><div class="value">${fmt(counts.get(s.value) || 0)}</div></button>`).join('')}
          <div class="stat" style="border-top-color:${C.text2}"><div class="label">📈 Pick-up rate</div><div class="value">${pct(picked, called.length)}</div>
            <div class="sub">${fmt(picked)} picked of ${fmt(called.length)} called</div></div>
        </div>
        <div class="section-title"><span>Call status breakdown</span></div>
        <div class="row">${card('callChart', 'Call Status', 'Share of called candidates · click a bar to filter')}${card('callDayChart', 'Calls per day', 'By Call Date', 'chart')}</div>
        <div class="section-title"><span>${sel ? `${esc([...sel].join(', '))} — candidates` : 'Called candidates'}</span></div>
        <div class="card"><div id="callTable"></div></div>`;
      p.querySelectorAll('.stat-btn').forEach((b) => b.addEventListener('click', () => toggle('callStatus', b.dataset.v)));

      // "Not called yet" has its own card; charting it would flatten the real call results.
      const items = CALL_STATUSES.filter((s) => !NOT_CALLED.has(s.value)).map((s) => ({ name: s.value, value: counts.get(s.value) || 0 }));
      hbar($('#callChart'), items, { key: 'callStatus', total: called.length, color: callColor });

      // Calls per day, stacked by status.
      const dated = called.filter((r) => r.callDate);
      const days = [...new Set(dated.map((r) => r.callDate))].sort();
      const shown = CALL_STATUSES.filter((s) => !NOT_CALLED.has(s.value) && dated.some((r) => r.callStatus === s.value));
      if (!days.length) $('#callDayChart').innerHTML = '<div class="empty">No call dates recorded yet</div>';
      else mountChart($('#callDayChart'), {
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { color: C.text2 } },
        grid: { left: 6, right: 12, top: 32, bottom: 6, containLabel: true },
        tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(198,40,40,.06)' } },
          formatter: (ps) => `<div style="color:${C.muted};font-size:11.5px">${esc(ps[0].name)}</div>${ps.filter((x) => x.value).map((x) => tipRow(x.color, x.seriesName, fmt(x.value))).join('')}` }),
        xAxis: { type: 'category', data: days.map(dayLabel), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted } },
        yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f0f0f3' } }, axisLabel: { color: C.muted } },
        series: shown.map((s) => ({
          name: s.value, type: 'bar', stack: 'calls', barMaxWidth: 34, itemStyle: { color: s.color, borderColor: '#fff', borderWidth: 1 },
          data: days.map((d) => dated.filter((r) => r.callDate === d && r.callStatus === s.value).length),
        })),
      }, (e) => toggle('callStatus', e.seriesName));

      const tableRows = sel ? rows : rows.filter((r) => !NOT_CALLED.has(r.callStatus));
      candidateTable($('#callTable'), tableRows, ['name', 'callStatus', 'callDate', 'callRemarks', 'interview', 'stage', 'source', 'job', 'owner'], { sortKey: 'callDate' });
    },
  },
  {
    id: 'round', icon: '🎯', label: 'Round Status',
    render(p, rows) {
      const inRound = rows.filter((r) => r.assessmentStatus !== 'Not started' || r.technicalStatus !== 'Not started' || r.hrResult !== 'Not recorded' || r.interviewDate || r.hrDate || r.technicalDate);
      const scores = rows.map((r) => r.assessmentScore).filter((s) => s != null);
      p.innerHTML = `
        ${stats([['Candidates in any round', fmt(inRound.length)],
          ['Assessment done', fmt(rows.filter((r) => r.assessmentStatus !== 'Not started').length), scores.length ? `Median score ${median(scores)}` : ''],
          ['Technical round', fmt(rows.filter((r) => r.technicalStatus !== 'Not started').length)],
          ['HR round', fmt(rows.filter((r) => r.hrResult !== 'Not recorded').length)],
          ['Interviews scheduled', fmt(rows.filter((r) => r.interviewDate).length)]])}
        <div class="section-title"><span>Results by round</span></div>
        <div class="row">
          ${card('assessStatus', 'Assessment Status', 'Click a bar to filter')}
          ${card('assessResult', 'Assessment Result')}
        </div>
        <div class="row">
          ${card('techStatus', 'Technical Status')}
          ${card('hrResult', 'HR Result')}
        </div>
        <div class="section-title"><span>Candidates in rounds</span></div>
        <div class="card"><div id="roundTable"></div></div>`;
      const inR = (key, empty) => rows.filter((r) => F[key].get(r) !== empty);
      hbar($('#assessStatus'), byKey(inR('assessmentStatus', 'Not started'), 'assessmentStatus'), { key: 'assessmentStatus', color: toneColor });
      hbar($('#assessResult'), byKey(inR('assessmentResult', 'Not recorded'), 'assessmentResult'), { key: 'assessmentResult', color: toneColor });
      hbar($('#techStatus'), byKey(inR('technicalStatus', 'Not started'), 'technicalStatus'), { key: 'technicalStatus', color: toneColor });
      hbar($('#hrResult'), byKey(inR('hrResult', 'Not recorded'), 'hrResult'), { key: 'hrResult', color: toneColor });
      candidateTable($('#roundTable'), inRound, ['name', 'assessment', 'score', 'technical', 'rating', 'hr', 'final', 'job'], { sortKey: 'name', sortDir: 1 });
    },
  },
  {
    id: 'final', icon: '🏁', label: 'Final Status',
    render(p, rows) {
      const decided = rows.filter((r) => r.finalStatus !== 'Not recorded' || r.hiringResult !== 'Not recorded' || r.outcome !== 'No decision' || r.hired);
      p.innerHTML = `
        ${stats([['Selected', fmt(rows.filter((r) => r.outcome === 'Selected').length)],
          ['Not selected / rejected', fmt(rows.filter((r) => r.outcome === 'Rejected').length)],
          ['On hold', fmt(rows.filter((r) => r.outcome === 'On hold').length)],
          ['Offered', fmt(rows.filter((r) => r.stage === 'Offered').length)],
          ['Hired / onboarding', fmt(rows.filter((r) => r.hired).length)]])}
        <div class="section-title"><span>Final outcomes</span></div>
        <div class="row">${card('finalStatus', 'Final Status', ' ')}${card('hiringResult', 'Hiring Result', ' ')}</div>
        <div class="row">${card('outcomeChart', 'Overall outcome', ' ')}${card('candStatus', 'Candidate Status', 'Click a bar to filter')}</div>
        <div class="section-title"><span>Candidates with a final decision</span></div>
        <div class="card"><div id="finalTable"></div></div>`;
      recordedBars('finalStatus', rows, 'finalStatus', 'Not recorded');
      recordedBars('hiringResult', rows, 'hiringResult', 'Not recorded');
      recordedBars('outcomeChart', rows, 'outcome', 'No decision', { order: ['Selected', 'On hold', 'Rejected'] });
      hbar($('#candStatus'), byKey(rows, 'status'), { key: 'status', total: rows.length, color: toneColor });
      candidateTable($('#finalTable'), decided, ['name', 'final', 'hiring', 'hr', 'outcome', 'stage', 'job', 'owner'], { sortKey: 'name', sortDir: 1 });
    },
  },
  {
    id: 'pipeline', icon: '📈', label: 'Stage & Source',
    render(p, rows) {
      const steps = DATA.funnel.map((name, i) => ({ name, value: rows.filter((r) => r.level >= i).length }));
      p.innerHTML = `
        <div class="section-title"><span>Recruitment pipeline</span></div>
        <div class="row">${card('funnel', 'Pipeline steps', 'Each candidate counts at every step up to the furthest one reached')}${card('stageChart', 'Candidate Stage', 'Click a bar to filter')}</div>
        <div class="section-title"><span>Where candidates come from</span></div>
        <div class="row">${card('channelChart', 'Source channel', 'Sources grouped · click a slice to filter', 'chart')}${card('sourceChart', 'Top sources', 'Click a bar to filter')}</div>
        <div class="row">${card('originChart', 'Origin', 'Sourced by recruiters vs. applied directly', 'chart')}${card('ownerChart', 'Candidate Owner', '', 'chart')}</div>`;
      hbar($('#funnel'), steps, { total: steps[0].value, color: () => C.red });
      hbar($('#stageChart'), byKey(rows, 'stage', { order: ['New', 'Engaged', 'In Review', 'Available', 'Offered', 'Hired', 'Not specified'] }), { key: 'stage', total: rows.length });
      donut($('#channelChart'), byKey(rows, 'sourceGroup', { top: 5 }), { key: 'sourceGroup', total: rows.length });
      hbar($('#sourceChart'), byKey(rows, 'source', { top: 15 }), { key: 'source', total: rows.length });
      donut($('#originChart'), byKey(rows, 'origin'), { key: 'origin', total: rows.length });
      donut($('#ownerChart'), byKey(rows, 'owner', { top: 5 }), { key: 'owner', total: rows.length });
    },
  },
  {
    id: 'profile', icon: '👤', label: 'Candidate Profile',
    render(p, rows) {
      const ages = rows.map((r) => r.age).filter((a) => a != null);
      const exps = rows.map((r) => r.expYears).filter((e) => e != null);
      p.innerHTML = `
        ${stats([['Median age', ages.length ? String(median(ages)) : '–', `Age known for ${pct(ages.length, rows.length)}`],
          ['Median experience', exps.length ? `${+median(exps).toFixed(1)} ${+median(exps).toFixed(1) === 1 ? 'yr' : 'yrs'}` : '–', `Known for ${pct(exps.length, rows.length)}`],
          ['Freshers', fmt(rows.filter((r) => r.expBand === 'Fresher').length)],
          ['Resume attached', pct(rows.filter((r) => r.resume).length, rows.length)]])}
        <div class="section-title"><span>Experience, age & gender</span></div>
        <div class="row">${card('expChart', 'Work experience', 'Click a bar to filter')}${card('ageChart', 'Age')}</div>
        <div class="row">${card('genderChart', 'Gender', 'Based on salutation (Mr. / Ms.) — most records leave it blank', 'chart')}${card('deptChart', 'Department')}</div>
        <div class="section-title"><span>Location</span></div>
        <div class="row">${card('countryChart', 'Country')}${card('stateChart', 'State')}</div>
        <div class="row">${card('cityChart', 'Top cities')}${card('tagChart', 'Tags')}</div>`;
      hbar($('#expChart'), byKey(rows, 'expBand'), { key: 'expBand', total: rows.length });
      hbar($('#ageChart'), byKey(rows, 'ageBand'), { key: 'ageBand', total: rows.length });
      donut($('#genderChart'), byKey(rows, 'gender'), { key: 'gender', total: rows.length, colors: { Male: C.cat[1], Female: C.cat[0] } });
      hbar($('#deptChart'), byKey(rows, 'department'), { key: 'department', total: rows.length });
      hbar($('#countryChart'), byKey(rows, 'country'), { key: 'country', total: rows.length });
      hbar($('#stateChart'), byKey(rows, 'state', { top: 12 }), { key: 'state', total: rows.length });
      const cities = countBy(rows, F.city.get); cities.delete('Not specified');
      hbar($('#cityChart'), sortedItems(cities, { top: 12 }), { key: 'city', total: rows.length });
      hbar($('#tagChart'), byKey(rows, 'tags'), { key: 'tags', total: rows.length });
    },
  },
  {
    id: 'jobs', icon: '💼', label: 'Job Openings',
    render(p, rows) {
      const withJob = rows.filter((r) => r.applications > 0);
      p.innerHTML = `
        ${stats([['Candidates who applied', fmt(withJob.length), `${pct(withJob.length, rows.length)} of candidates`],
          ['Applications', fmt(withJob.reduce((s, r) => s + r.applications, 0))],
          ['Open job openings', fmt(DATA.jobs.filter((j) => /progress|open|active/i.test(j.status || '')).length), `${fmt(DATA.jobs.length)} in total`]])}
        <div class="section-title"><span>Candidates by job opening</span></div>
        <div class="row">${card('jobChart', 'Candidates per job opening', 'Click a bar to filter')}${card('appChart', 'Application Status')}</div>
        <div class="section-title"><span>All job openings in Zoho Recruit</span></div>
        <div class="card"><div class="table-wrap"><table><thead><tr><th>Job Opening</th><th>Status</th><th>Type</th><th>Opened</th><th>Positions</th><th>Candidates</th><th>Hired</th></tr></thead><tbody>${
          [...DATA.jobs].sort((a, b) => b.associated - a.associated).map((j) => `<tr><td>${esc(j.title)}</td><td>${tagCell(j.status || '–')}</td><td>${esc(j.type || '–')}</td><td>${j.opened ? esc(dayLabel(j.opened)) : '–'}</td><td class="num">${fmt(j.positions)}</td><td class="num">${fmt(j.associated)}</td><td class="num">${fmt(j.hired)}</td></tr>`).join('')
        }</tbody></table></div></div>`;
      const jobs = countBy(withJob, F.job.get);
      hbar($('#jobChart'), sortedItems(jobs, { top: 12 }), { key: 'job', total: withJob.length, maxLabel: 34 });
      hbar($('#appChart'), byKey(withJob, 'appStatus'), { key: 'appStatus', total: withJob.length, color: toneColor });
    },
  },
  {
    id: 'list', icon: '📋', label: 'Candidate List',
    render(p, rows) {
      p.innerHTML = `
        <div class="section-title"><span>${fmt(rows.length)} candidates match your filters</span><button class="btn primary" id="exportBtn">⬇ Export CSV</button></div>
        <div class="card"><div id="listTable"></div></div>`;
      candidateTable($('#listTable'), rows, ['code', 'name', 'created', 'stage', 'status', 'source', 'owner', 'location', 'job', 'exp', 'age', 'outcome'], { pageSize: 50 });
      $('#exportBtn').addEventListener('click', () => exportCsv(rows));
    },
  },
];

// ---------- filter controls ----------
function buildFilterControls() {
  for (const f of FILTERS) {
    const label = document.createElement('label');
    label.className = 'f'; label.dataset.key = f.key;
    label.innerHTML = `<span>${esc(f.label)}</span><select></select>`;
    label.querySelector('select').addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__all') delete active[f.key];
      else if (v !== '__multi') active[f.key] = new Set([v]);
      render();
    });
    (f.main ? $('#mainFilters') : $('#moreFilters')).appendChild(label);
  }
}

function syncFilterControls() {
  for (const label of document.querySelectorAll('.f[data-key]')) {
    const f = F[label.dataset.key];
    const sel = label.querySelector('select');
    const counts = countBy(filtered(f.key), f.get);
    const all = countBy(DATA.records, f.get);
    let values = f.order ? f.order().filter((v) => f.showZero || all.has(v)) : [...all].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const set = active[f.key];
    const opts = [`<option value="__all">All</option>`];
    if (set?.size > 1) opts.push(`<option value="__multi">${set.size} selected</option>`);
    for (const v of values) opts.push(`<option value="${esc(v)}">${esc(v)} (${fmt(counts.get(v) || 0)})</option>`);
    sel.innerHTML = opts.join('');
    sel.value = !set ? '__all' : set.size > 1 ? '__multi' : [...set][0];
    label.classList.toggle('active', Boolean(set));
  }
  const moreActive = FILTERS.filter((f) => !f.main && active[f.key]).length;
  $('#moreBtn').textContent = `${$('#moreFilters').hidden ? 'More filters ▾' : 'Fewer filters ▴'}${moreActive ? ` (${moreActive} active)` : ''}`;
}

function renderChips() {
  const chips = [];
  for (const [k, set] of Object.entries(active)) for (const v of set) chips.push({ label: F[k].label, value: v, remove: () => toggle(k, v) });
  if (dates.preset !== 'all') {
    const [from, to] = dateBounds();
    chips.push({ label: 'Created', value: from === to ? dayLabel(from) : `${from ? dayLabel(from) : '…'} – ${to ? dayLabel(to) : '…'}`, remove: resetDates });
  }
  if (search) chips.push({ label: 'Search', value: search, remove: () => { search = ''; $('#search').value = ''; render(); } });
  const box = $('#chips');
  box.replaceChildren(...chips.map((c) => {
    const el = document.createElement('span'); el.className = 'chip';
    const b = document.createElement('b'); b.textContent = `${c.label}: `;
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', `Remove ${c.label} filter`);
    x.addEventListener('click', c.remove);
    el.append(b, c.value, x); return el;
  }));
  $('#clearBtn').hidden = !chips.length;
}

function resetDates() {
  dates = { preset: 'all', from: '', to: '' };
  $('#datePreset').value = 'all'; $('#dateFrom').value = ''; $('#dateTo').value = '';
  document.querySelectorAll('.f.custom').forEach((el) => { el.hidden = true; });
  render();
}

// ---------- render ----------
function buildTabs() {
  $('#tabs').innerHTML = TABS.map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === currentTab}"><span class="ico">${t.icon}</span>${esc(t.label)}</button>`).join('');
  $('#tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    currentTab = b.dataset.tab;
    $('#tabs').querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    history.replaceState(null, '', `#${currentTab}`);
    render();
  }));
}

function render() {
  if (!DATA) return;
  charts.forEach((c) => c.dispose()); charts = [];
  const rows = filtered();
  $('#totalPill').textContent = `Total: ${fmt(rows.length)}${rows.length !== DATA.records.length ? ` of ${fmt(DATA.records.length)}` : ''}`;
  const panel = document.createElement('div');
  $('#panels').replaceChildren(panel);
  TABS.find((t) => t.id === currentTab).render(panel, rows);
  syncFilterControls();
  renderChips();
}

function exportCsv(rows) {
  const cols = ['code', 'name', 'created', 'stage', 'status', 'source', 'origin', 'owner', 'department', 'location', 'city', 'state', 'country', 'gender', 'age', 'expYears',
    'jobs', 'appStatus', 'callStatus', 'callDate', 'assessmentStatus', 'assessmentResult', 'assessmentScore', 'technicalStatus', 'technicalRating', 'hrResult', 'hiringResult', 'finalStatus', 'outcome'];
  const cell = (v) => { const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
  a.download = `candidates-${today()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- data ----------
const EXPECTED_SCHEMA = 2; // must match SCHEMA_VERSION in lib/transform.js
function banner(msg) { $('#banner').hidden = !msg; $('#banner').textContent = msg || ''; }

async function load() {
  $('#main').classList.add('loading');
  try {
    const res = await fetch('/api/data');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (body.schema !== EXPECTED_SCHEMA) {
      throw new Error('The server is running an older version of the dashboard. In the terminal press Ctrl+C, run "npm start" again, then reload this page.');
    }
    for (const r of body.records) r._search = [r.name, r.code, r.role, r.location, r.source, r.jobs.join(' ')].filter(Boolean).join(' ').toLowerCase();
    DATA = body;
    if (DATA.orgId) $('#openRecruit').href = `https://recruit.zoho.com/recruit/org${DATA.orgId}/ShowTab.do?module=Candidates`;
    // Last sync time stays available on hover over the Refresh button.
    $('#refreshBtn').title = `Last synced ${new Date(DATA.fetchedAt).toLocaleString()} · click to fetch the latest data from Zoho`;
    banner('');
    render();
  } catch (err) {
    banner(`Couldn't load candidates: ${err.message}`);
    DATA = null;
  } finally {
    $('#main').classList.remove('loading');
  }
}

async function refreshFromZoho() {
  const btn = $('#refreshBtn');
  btn.disabled = true; btn.textContent = '↻ Syncing…';
  await fetch('/api/refresh', { method: 'POST' });
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const s = await (await fetch('/api/status')).json();
    if (s.state === 'error') banner(`Sync failed: ${s.message}`);
    if (s.state !== 'loading') break;
  }
  btn.disabled = false; btn.textContent = '↻ Refresh';
  await load();
}

// ---------- wiring ----------
// The URL hash picks the tab, so each tab can be bookmarked (e.g. /#call).
const hashTab = location.hash.slice(1);
if (TABS.some((x) => x.id === hashTab)) currentTab = hashTab;
buildTabs();
buildFilterControls();

$('#datePreset').addEventListener('change', (e) => {
  dates.preset = e.target.value;
  document.querySelectorAll('.f.custom').forEach((el) => { el.hidden = dates.preset !== 'custom'; });
  render();
});
$('#dateFrom').addEventListener('change', (e) => { dates.from = e.target.value; render(); });
$('#dateTo').addEventListener('change', (e) => { dates.to = e.target.value; render(); });
let timer;
$('#search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { search = e.target.value.trim(); render(); }, 250); });
$('#moreBtn').addEventListener('click', () => {
  const box = $('#moreFilters'); box.hidden = !box.hidden;
  $('#moreBtn').setAttribute('aria-expanded', String(!box.hidden));
  syncFilterControls();
});
$('#clearBtn').addEventListener('click', () => {
  Object.keys(active).forEach((k) => delete active[k]);
  search = ''; $('#search').value = '';
  resetDates();
});
$('#refreshBtn').addEventListener('click', refreshFromZoho);
window.addEventListener('resize', () => charts.forEach((c) => c.resize()));

load();
