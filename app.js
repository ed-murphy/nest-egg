'use strict';

const { fmtMoney, fmtPct } = Charts;
const $ = id => document.getElementById(id);

const DEFAULTS = {
  currentAge: 35, retireAge: 65, endAge: 95,
  savings: 150000, contribution: 20000, contribGrowth: 1,
  spending: 70000, otherIncome: 24000, incomeStartAge: 67,
  flexCut: 0, flexTrigger: 80,
  stockAccum: 90, stockRetire: 60, fees: 0.2,
  model: 'bootstrap', nSims: 10000,
  stockMean: +(Sim.HIST_STATS.stock.mean * 100).toFixed(1), stockSD: +(Sim.HIST_STATS.stock.sd * 100).toFixed(1),
  bondMean: +(Sim.HIST_STATS.bond.mean * 100).toFixed(1), bondSD: +(Sim.HIST_STATS.bond.sd * 100).toFixed(1),
  seed: 42,
};
const PIN_COLORS = ['--series-2', '--series-3'];

const S = { p: { ...DEFAULTS }, res: null, pinned: [], timer: null, tableOpen: false, log: false };

// ---------------------------------------------------------------- inputs
const fields = [...document.querySelectorAll('[data-key]')];
function writeInputs() {
  for (const f of fields) { const k = f.dataset.key; f.value = S.p[k]; f.classList.remove('invalid'); }
  $('normal-params').hidden = S.p.model !== 'normal';
  $('hist-note').textContent = MODEL_NOTE[S.p.model];
}
const H = Sim.HIST_STATS;
const MODEL_NOTE = {
  bootstrap: `Each simulated year is a random real year from ${H.from}–${H.to}, so booms and crashes appear as often as they actually did. Recommended.`,
  block: 'Draws random 5-year runs of consecutive real years, so streaks like 1929–33 or 1995–99 stay intact.',
  historical: `One path per starting year ${H.from}–${H.to}: the classic "would this have survived history" test. Only ${H.years} paths, so percentiles are coarse.`,
  normal: `Draws from a bell curve with the return and volatility below. Defaults match history after inflation: stocks ${(H.stock.mean * 100).toFixed(1)}% ± ${(H.stock.sd * 100).toFixed(1)}%, bonds ${(H.bond.mean * 100).toFixed(1)}% ± ${(H.bond.sd * 100).toFixed(1)}%.`,
};
function readInputs() {
  const p = { ...S.p };
  for (const f of fields) {
    const k = f.dataset.key;
    if (f.tagName === 'SELECT') p[k] = k === 'nSims' ? +f.value : f.value;
    else { const v = parseFloat(f.value); if (Number.isFinite(v)) p[k] = v; }
  }
  return sanitize(p);
}
function sanitize(p) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  p.currentAge = clamp(Math.round(p.currentAge), 18, 90);
  p.retireAge = clamp(Math.round(p.retireAge), p.currentAge + 1, 105);
  p.endAge = clamp(Math.round(p.endAge), p.retireAge + 1, 110);
  p.incomeStartAge = clamp(Math.round(p.incomeStartAge), 18, 110);
  for (const k of ['savings', 'contribution', 'spending', 'otherIncome']) p[k] = Math.max(0, p[k]);
  p.stockAccum = clamp(p.stockAccum, 0, 100); p.stockRetire = clamp(p.stockRetire, 0, 100);
  p.fees = clamp(p.fees, 0, 5); p.flexCut = clamp(p.flexCut, 0, 80); p.flexTrigger = clamp(p.flexTrigger, 10, 100);
  p.stockSD = Math.max(0, p.stockSD); p.bondSD = Math.max(0, p.bondSD);
  p.nSims = 10000;
  if (!['bootstrap', 'block', 'historical', 'normal'].includes(p.model)) p.model = 'bootstrap';
  return p;
}
fields.forEach(f => f.addEventListener('input', () => {
  S.p = readInputs();
  // reflect any clamping back into the form without fighting the user's typing
  for (const g of fields) if (g !== f && g.tagName !== 'SELECT' && +g.value !== S.p[g.dataset.key]) g.value = S.p[g.dataset.key];
  $('normal-params').hidden = S.p.model !== 'normal';
  $('hist-note').textContent = MODEL_NOTE[S.p.model];
  schedule();
}));
fields.forEach(f => f.addEventListener('change', () => { writeInputs(); }));

// ------------------------------------------------------------------ run
function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(runAll, 120);
}
function runAll() {
  S.res = Sim.run(S.p);
  render();
  updateHash();
}

// --------------------------------------------------------------- render
function render() {
  const r = S.res, p = S.p;
  $('hero-age').textContent = p.endAge;
  $('hero-success').textContent = fmtPct(r.success);
  const modelName = { bootstrap: 'random years from history', block: 'random 5-year stretches from history', historical: 'every start year since 1928', normal: 'bell-curve returns' }[p.model];
  $('hero-note').textContent = `${r.N.toLocaleString()} simulated lives · ${modelName}`;

  $('kpi-retire').textContent = fmtMoney(r.atRetire.p50);
  $('kpi-retire-sub').textContent = `at ${p.retireAge} · 10th–90th: ${fmtMoney(r.atRetire.p10)} – ${fmtMoney(r.atRetire.p90)}`;
  $('kpi-end').textContent = fmtMoney(r.end.p50);
  $('kpi-end-sub').textContent = `at ${p.endAge}, today's dollars`;
  $('kpi-end10').textContent = fmtMoney(r.end.p10);
  $('kpi-end10-sub').textContent = r.end.p10 <= 0 ? 'more than 10% of paths run dry' : '1 in 10 paths ends below this';
  if (r.medianFailAge != null) {
    $('kpi-fail').textContent = `Age ${r.medianFailAge}`;
    $('kpi-fail-sub').textContent = `median among the ${fmtPct(1 - r.success)} of paths that run out`;
  } else { $('kpi-fail').textContent = 'None'; $('kpi-fail-sub').textContent = 'no path ran out of money'; }

  const pinned = S.pinned.map((s, i) => ({ name: s.name, color: cssVar(PIN_COLORS[i]), ages: s.ages, p50: s.p50 }));
  Charts.fan($('fan'), r, p, pinned, { log: S.log });
  renderLegend(pinned);
  if (S.tableOpen) renderTable();
  Charts.failHist($('hist'), r);
  renderScenarios();
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function renderLegend(pinned) {
  const lg = $('fan-legend'); lg.innerHTML = '';
  const item = (label, swatchStyle, cls) => {
    const s = document.createElement('span'); const i = document.createElement('i'); i.className = cls || ''; i.setAttribute('style', swatchStyle);
    s.append(i, document.createTextNode(label)); lg.appendChild(s);
  };
  item('Current median', `background:${cssVar('--series-1')}`);
  item('Percentile bands', `background:${cssVar('--series-1')}`, 'band');
  pinned.forEach(s => item(`${s.name} median`, `background:${s.color}`));
}

function renderTable() {
  const r = S.res, box = $('fan-table');
  const tbl = document.createElement('table');
  tbl.innerHTML = '<thead><tr><th>Age</th><th>10th</th><th>25th</th><th>Median</th><th>75th</th><th>90th</th></tr></thead>';
  const tb = document.createElement('tbody');
  r.ages.forEach((a, i) => {
    const tr = document.createElement('tr'); if (a === S.p.retireAge) tr.className = 'retire';
    const cells = [a === S.p.retireAge ? `${a} (retire)` : String(a), r.pct.p10[i], r.pct.p25[i], r.pct.p50[i], r.pct.p75[i], r.pct.p90[i]];
    cells.forEach((c, j) => { const td = document.createElement('td'); td.textContent = j ? fmtMoney(c) : c; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); box.innerHTML = ''; box.appendChild(tbl);
}
$('btn-scale').addEventListener('click', () => {
  S.log = !S.log;
  $('btn-scale').textContent = S.log ? 'Log scale' : 'Linear scale';
  if (S.res) render();
});
$('btn-table').addEventListener('click', () => {
  S.tableOpen = !S.tableOpen;
  $('fan-table').hidden = !S.tableOpen;
  $('btn-table').textContent = S.tableOpen ? 'Hide table' : 'Table';
  if (S.tableOpen) renderTable();
});

// ------------------------------------------------------------ scenarios
function describe(p) {
  const bits = [`retire ${p.retireAge}`, `${fmtMoney(p.spending)}/yr`, `${p.stockRetire}% stocks`];
  if (p.otherIncome) bits.push(`${fmtMoney(p.otherIncome)} income @${p.incomeStartAge}`);
  if (p.flexCut) bits.push(`${p.flexCut}% cuts`);
  return bits.join(' · ');
}
function renderScenarios() {
  const box = $('scenarios'); box.innerHTML = '';
  const rows = [{ name: 'Current', color: cssVar('--series-1'), p: S.p, res: S.res, live: true }]
    .concat(S.pinned.map((s, i) => ({ name: s.name, color: cssVar(PIN_COLORS[i]), p: s.p, res: s.res, idx: i })));
  const tbl = document.createElement('table');
  tbl.innerHTML = '<thead><tr><th>Scenario</th><th>Success</th><th>Median at retirement</th><th>Median ending</th><th>10th pct ending</th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  const base = S.res.success;
  for (const row of rows) {
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.className = 'name';
    const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = row.color;
    const nm = document.createElement('b'); nm.textContent = row.name;
    const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = describe(row.p);
    name.append(sw, nm, desc); tr.appendChild(name);
    const succ = document.createElement('td'); succ.textContent = fmtPct(row.res.success);
    if (!row.live) { const d = row.res.success - base; if (Math.abs(d) >= 0.005) { succ.className = d > 0 ? 'up' : 'down'; succ.textContent += ` (${d > 0 ? '+' : ''}${Math.round(d * 100)})`; } }
    tr.appendChild(succ);
    for (const v of [row.res.atRetire.p50, row.res.end.p50, row.res.end.p10]) { const td = document.createElement('td'); td.textContent = fmtMoney(v); tr.appendChild(td); }
    const act = document.createElement('td');
    if (!row.live) {
      const load = document.createElement('button'); load.textContent = 'Load'; load.title = 'Put these inputs back in the form';
      load.addEventListener('click', () => { S.p = { ...row.p }; writeInputs(); runAll(); });
      const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = 'Unpin';
      rm.addEventListener('click', () => { S.pinned.splice(row.idx, 1); S.pinned.forEach((s, i) => s.name = String.fromCharCode(65 + i)); render(); });
      act.append(load, rm);
    }
    tr.appendChild(act); tb.appendChild(tr);
  }
  tbl.appendChild(tb); box.appendChild(tbl);
  if (!S.pinned.length) { const h = document.createElement('p'); h.className = 'hint'; h.textContent = 'Nothing pinned yet. Change some inputs, then pin to compare against the current run (up to 2).'; box.appendChild(h); }
}
$('btn-pin').addEventListener('click', () => {
  if (S.pinned.length >= 2) { toast('Two scenarios already pinned — unpin one first.'); return; }
  const r = S.res;
  S.pinned.push({ name: String.fromCharCode(65 + S.pinned.length), p: { ...S.p }, ages: r.ages.slice(), p50: Float64Array.from(r.pct.p50),
    res: { success: r.success, atRetire: r.atRetire, end: r.end } });
  render();
  toast(`Pinned as scenario ${S.pinned[S.pinned.length - 1].name}`);
});
$('btn-reset').addEventListener('click', () => { S.p = { ...DEFAULTS }; writeInputs(); runAll(); });
$('btn-reroll').addEventListener('click', () => { S.p.seed = (Math.random() * 2 ** 31) >>> 0; runAll(); toast('Resampled with a fresh seed'); });

// -------------------------------------------------------------- sharing
function updateHash() {
  const parts = [];
  for (const k of Object.keys(DEFAULTS)) if (S.p[k] !== DEFAULTS[k]) parts.push(`${k}=${encodeURIComponent(S.p[k])}`);
  history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
}
function readHash() {
  if (!location.hash.length) return;
  const p = { ...DEFAULTS };
  for (const kv of location.hash.slice(1).split('&')) {
    const [k, v] = kv.split('=');
    if (!(k in DEFAULTS)) continue;
    p[k] = typeof DEFAULTS[k] === 'number' ? parseFloat(decodeURIComponent(v)) : decodeURIComponent(v);
    if (typeof DEFAULTS[k] === 'number' && !Number.isFinite(p[k])) p[k] = DEFAULTS[k];
  }
  S.p = sanitize(p);
}
$('btn-share').addEventListener('click', async () => {
  updateHash();
  try { await navigator.clipboard.writeText(location.href); toast('Link copied'); }
  catch (e) { toast('Copy failed — the URL bar has the link'); }
});

// ---------------------------------------------------------------- theme
$('btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('nestegg-theme', next); } catch (e) { /* ignore */ }
  render();
});
try { const t = localStorage.getItem('nestegg-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

let toastTimer;
function toast(msg) {
  let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

// re-render charts on resize (debounced)
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.res) render(); }, 150); });

// ----------------------------------------------------------------- boot
readHash();
writeInputs();
runAll();
