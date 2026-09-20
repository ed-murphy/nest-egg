'use strict';

// ---------------------------------------------------------------------------
// Monte Carlo retirement engine. Everything is in today's (real) dollars:
// historical nominal returns are deflated by that year's CPI before use, so
// inflation never has to be modelled separately.
// ---------------------------------------------------------------------------
const Sim = (() => {
  // Deterministic PRNG so a given seed always produces the same paths.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rand) { // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Real (inflation-adjusted) annual returns derived from HISTORY (data.js).
  const REAL = (() => {
    const stock = [], bond = [], years = [];
    for (const [y, sp, tb, _bill, inf] of HISTORY) {
      years.push(y);
      stock.push((1 + sp / 100) / (1 + inf / 100) - 1);
      bond.push((1 + tb / 100) / (1 + inf / 100) - 1);
    }
    return { stock, bond, years };
  })();

  function meanSd(a) {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
    return { mean: m, sd };
  }
  const HIST_STATS = { stock: meanSd(REAL.stock), bond: meanSd(REAL.bond), years: REAL.years.length,
    from: REAL.years[0], to: REAL.years[REAL.years.length - 1] };

  const BLOCK = 5; // years per block in block bootstrap

  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // p: inputs (see app.js DEFAULTS). opts.light => success rate + end balances only.
  function run(p, opts = {}) {
    const years = Math.max(1, p.endAge - p.currentAge);
    const n = REAL.stock.length;
    const N = p.model === 'historical' ? n : p.nSims;
    const rand = mulberry32(p.seed);
    const full = !opts.light;
    const stride = years + 1;
    const paths = full ? new Float64Array(N * stride) : null;
    const endBal = new Float64Array(N);
    const failAge = new Int16Array(N).fill(-1);
    let successes = 0;
    const wAcc = p.stockAccum / 100, wRet = p.stockRetire / 100, fee = p.fees / 100;
    const cutMult = 1 - p.flexCut / 100, trigger = p.flexTrigger / 100;

    for (let i = 0; i < N; i++) {
      let bal = p.savings;
      if (full) paths[i * stride] = bal;
      let blockLeft = 0, idx = 0, failed = false, balAtRetire = -1;
      for (let t = 0; t < years; t++) {
        const age = p.currentAge + t;
        let rs, rb;
        if (p.model === 'normal') {
          rs = p.stockMean / 100 + (p.stockSD / 100) * gauss(rand);
          rb = p.bondMean / 100 + (p.bondSD / 100) * gauss(rand);
        } else {
          if (p.model === 'historical') idx = (i + t) % n;             // every actual start year, wrapping
          else if (p.model === 'block') {                               // runs of consecutive years
            if (blockLeft === 0) { idx = Math.floor(rand() * n); blockLeft = BLOCK; } else idx = (idx + 1) % n;
            blockLeft--;
          } else idx = Math.floor(rand() * n);                          // i.i.d. bootstrap
          rs = REAL.stock[idx]; rb = REAL.bond[idx];
        }
        const retired = age >= p.retireAge;
        const w = retired ? wRet : wAcc;
        const r = w * rs + (1 - w) * rb - fee;

        if (!retired) {
          bal += p.contribution * Math.pow(1 + p.contribGrowth / 100, t);
        } else if (!failed) {
          if (balAtRetire < 0) balAtRetire = bal;
          const income = age >= p.incomeStartAge ? p.otherIncome : 0;
          let spend = p.spending;
          if (p.flexCut > 0 && bal < balAtRetire * trigger) spend *= cutMult;
          bal -= Math.max(0, spend - income);
          if (bal <= 0) { bal = 0; failed = true; failAge[i] = age; }
        }
        bal *= (1 + r);
        if (failed) bal = 0;
        if (full) paths[i * stride + t + 1] = bal;
      }
      endBal[i] = bal;
      if (!failed) successes++;
    }

    const res = { N, years, success: successes / N, endBal, failAge };
    if (!full) return res;

    // percentiles per year
    const qs = { p5: 0.05, p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9, p95: 0.95 };
    const pct = {}; for (const k in qs) pct[k] = new Float64Array(stride);
    const col = new Float64Array(N);
    for (let t = 0; t < stride; t++) {
      for (let i = 0; i < N; i++) col[i] = paths[i * stride + t];
      col.sort();
      for (const k in qs) pct[k][t] = quantile(col, qs[k]);
    }
    res.pct = pct;
    res.ages = Array.from({ length: stride }, (_, t) => p.currentAge + t);

    // failure-age histogram
    const hist = new Map();
    for (let i = 0; i < N; i++) if (failAge[i] >= 0) hist.set(failAge[i], (hist.get(failAge[i]) || 0) + 1);
    res.failHist = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([age, c]) => ({ age, count: c, share: c / N }));
    const fa = Array.from(failAge).filter(a => a >= 0).sort((a, b) => a - b);
    res.medianFailAge = fa.length ? fa[Math.floor(fa.length / 2)] : null;

    const sortedEnd = Float64Array.from(endBal).sort();
    res.end = { p10: quantile(sortedEnd, 0.1), p50: quantile(sortedEnd, 0.5), p90: quantile(sortedEnd, 0.9) };
    const tR = Math.min(stride - 1, Math.max(0, p.retireAge - p.currentAge));
    res.atRetire = { p10: pct.p10[tR], p50: pct.p50[tR], p90: pct.p90[tR] };
    return res;
  }

  return { run, HIST_STATS, REAL };
})();
