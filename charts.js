'use strict';

// Small SVG chart kit: fan chart, failure-age histogram, sensitivity tornado.
// Colors come from CSS custom properties so light/dark swap in one place.
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, cls, attrs) {
    const t = el('text', Object.assign({ x, y, class: cls }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }

  function fmtMoney(v, digits) {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    const f = (n, d) => n.toFixed(d).replace(/\.0+$/, '');
    if (a >= 1e9) return `${s}$${f(a / 1e9, digits ?? 2)}B`;
    if (a >= 1e6) return `${s}$${f(a / 1e6, digits ?? (a >= 1e7 ? 1 : 2))}M`;
    if (a >= 1e3) return `${s}$${f(a / 1e3, digits ?? 0)}K`;
    return `${s}$${Math.round(a)}`;
  }
  const fmtPct = v => `${Math.round(v * 100)}%`;

  function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    const step = niceStep(max / (count || 5));
    const ticks = [];
    for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v);
    return ticks;
  }
  // Rounded on the data end only, square at the baseline. Horizontal bar from x0 (baseline) to x1.
  function hBar(x0, x1, y, h, r) {
    const dir = x1 >= x0 ? 1 : -1, w = Math.abs(x1 - x0);
    r = Math.min(r, w, h / 2);
    if (w < 0.5) return '';
    const xe = x1, xr = x1 - dir * r;
    return `M${x0},${y} H${xr} A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${xe},${y + r} V${y + h - r} A${r},${r} 0 0 ${dir > 0 ? 1 : 0} ${xr},${y + h} H${x0} Z`;
  }
  // Vertical column from baseline yb up to yt, rounded top.
  function vBar(x, w, yb, yt, r) {
    const h = yb - yt;
    r = Math.min(r, w / 2, h);
    if (h < 0.5) return '';
    return `M${x},${yb} V${yt + r} A${r},${r} 0 0 1 ${x + r},${yt} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${yt + r} V${yb} Z`;
  }

  function tooltip(container) {
    let tip = container.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; container.appendChild(tip); }
    return {
      show(html, x, y) {
        tip.innerHTML = '';
        tip.appendChild(html);
        tip.hidden = false;
        const cw = container.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = x + 14; if (left + tw > cw - 4) left = x - tw - 14;
        let top = y - th / 2; top = Math.max(4, Math.min(container.clientHeight - th - 4, top));
        tip.style.left = `${left}px`; tip.style.top = `${top}px`;
      },
      hide() { tip.hidden = true; },
    };
  }
  function tipRows(title, rows) {
    // rows: [{label, value, color?}] - values lead, labels follow; color = line key
    const box = document.createElement('div');
    const h = document.createElement('div'); h.className = 'tip-title'; h.textContent = title; box.appendChild(h);
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'tip-row';
      const key = document.createElement('span'); key.className = 'tip-key';
      if (r.color) key.style.background = r.color; else key.style.visibility = 'hidden';
      const v = document.createElement('strong'); v.textContent = r.value;
      const l = document.createElement('span'); l.className = 'tip-label'; l.textContent = r.label;
      row.append(key, v, l); box.appendChild(row);
    }
    return box;
  }

  // ------------------------------------------------------------------ fan
  // res: Sim result; p: inputs; pinned: [{name, color, ages, p50}]
  function fan(container, res, p, pinned, opts) {
    const log = !!(opts && opts.log);
    container.querySelectorAll('svg').forEach(s => s.remove());
    const W = Math.max(320, container.clientWidth || 800), H = 340;
    const m = { t: 24, r: 70, b: 34, l: 58 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Projected portfolio balance by age' }, container);
    const ages = res.ages, x0 = ages[0], x1 = ages[ages.length - 1];
    let ymax = 0;
    for (const v of res.pct.p90) ymax = Math.max(ymax, v);
    for (const s of pinned) for (const v of s.p50) ymax = Math.max(ymax, v);
    ymax = Math.max(ymax, p.savings, 1000);
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const sx = a => m.l + (a - x0) / (x1 - x0) * pw;
    let ticks, sy, ymin = 0;
    if (log) {
      // log scale: floor at $10K (anything below, including $0, sits on the baseline)
      ymin = 1e4;
      const top = Math.pow(10, Math.ceil(Math.log10(Math.max(ymax, ymin * 10))));
      ymax = top;
      ticks = [];
      for (let v = ymin; v <= top * 1.0001; v *= 10) { ticks.push(v); if (v * 3 < top) ticks.push(v * 3); }
      const lmin = Math.log10(ymin), lmax = Math.log10(ymax);
      sy = v => m.t + ph - ((Math.log10(Math.max(v, ymin)) - lmin) / (lmax - lmin)) * ph;
    } else {
      ticks = niceTicks(ymax * 1.04, 5); ymax = ticks[ticks.length - 1];
      sy = v => m.t + ph - (v / ymax) * ph;
    }

    // grid + y labels
    for (const v of ticks) {
      el('line', { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: v === ymin ? 'axis' : 'grid' }, svg);
      text(svg, m.l - 8, sy(v) + 4, (log && v === ymin ? '≤' : '') + fmtMoney(v), 'tick', { 'text-anchor': 'end' });
    }
    // x ticks
    const span = x1 - x0, pxPerYear = pw / span;
    const xs = [1, 2, 5, 10, 20].find(step => step * pxPerYear >= 36) || 20;   // keep labels >= 36px apart
    for (let a = Math.ceil(x0 / xs) * xs; a <= x1; a += xs) text(svg, sx(a), H - m.b + 18, String(a), 'tick', { 'text-anchor': 'middle' });
    text(svg, W - m.r, H - 4, 'Age', 'tick', { 'text-anchor': 'end' });

    // retirement marker
    if (p.retireAge > x0 && p.retireAge < x1) {
      const rx = sx(p.retireAge);
      el('line', { x1: rx, x2: rx, y1: m.t - 6, y2: m.t + ph, class: 'marker' }, svg);
      text(svg, rx + 5, m.t + 4, `Retire at ${p.retireAge}`, 'tick');
    }

    const band = (hiArr, loArr, cls) => {
      let d = '';
      ages.forEach((a, i) => { d += (i ? ' L' : 'M') + sx(a).toFixed(1) + ',' + sy(hiArr[i]).toFixed(1); });
      for (let i = ages.length - 1; i >= 0; i--) d += ' L' + sx(ages[i]).toFixed(1) + ',' + sy(loArr[i]).toFixed(1);
      el('path', { d: d + ' Z', class: cls }, svg);
    };
    band(res.pct.p90, res.pct.p10, 'band-outer');
    band(res.pct.p75, res.pct.p25, 'band-inner');
    const line = (arr, ag, cls, style) => {
      let d = '';
      ag.forEach((a, i) => { d += (i ? ' L' : 'M') + sx(a).toFixed(1) + ',' + sy(Math.min(arr[i], ymax)).toFixed(1); });
      const pth = el('path', { d, class: cls }, svg);
      if (style) pth.setAttribute('style', style);
      return pth;
    };
    for (const s of pinned) line(s.p50, s.ages, 'line', `stroke:${s.color}`);
    line(res.pct.p50, ages, 'line line-main');

    // direct labels at the right edge (muted ink, never the series color)
    const last = ages.length - 1;
    const labels = [
      { y: sy(res.pct.p90[last]), t: '90th' }, { y: sy(res.pct.p50[last]), t: 'Median' }, { y: sy(res.pct.p10[last]), t: '10th' },
    ].sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    for (const l of labels) text(svg, W - m.r + 8, l.y + 4, l.t, 'tick');
    // end marker on the median, with a surface ring
    el('circle', { cx: sx(x1), cy: sy(Math.min(res.pct.p50[last], ymax)), r: 4, class: 'dot dot-main' }, svg);

    // hover layer: crosshair + tooltip listing every series at that age
    const cross = el('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, class: 'crosshair', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' }, svg);
    const tip = tooltip(container);
    const mainColor = getComputedStyle(container).getPropertyValue('--series-1').trim();
    const onMove = e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * W / r.width;
      const i = Math.round((px - m.l) / pw * (ages.length - 1));
      if (i < 0 || i > last) return;
      const cx = sx(ages[i]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const rows = [
        { label: '90th percentile', value: fmtMoney(res.pct.p90[i]) },
        { label: '75th', value: fmtMoney(res.pct.p75[i]) },
        { label: 'Median', value: fmtMoney(res.pct.p50[i]), color: mainColor },
        { label: '25th', value: fmtMoney(res.pct.p25[i]) },
        { label: '10th', value: fmtMoney(res.pct.p10[i]) },
      ];
      for (const s of pinned) { const j = s.ages.indexOf(ages[i]); if (j >= 0) rows.push({ label: `${s.name} median`, value: fmtMoney(s.p50[j]), color: s.color }); }
      const stage = ages[i] < p.retireAge ? 'saving' : 'retired';
      tip.show(tipRows(`Age ${ages[i]} · ${stage}`, rows), cx * r.width / W, (e.clientY - r.top));
    };
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });
    return svg;
  }

  // ------------------------------------------------------------ histogram
  function failHist(container, res) {
    container.querySelectorAll('svg, .empty').forEach(s => s.remove());
    if (!res.failHist.length) {
      const d = document.createElement('div'); d.className = 'empty';
      d.textContent = 'No simulated path ran out of money before the plan-to age.';
      container.appendChild(d); return;
    }
    const W = Math.max(280, container.clientWidth || 500), H = 200;
    const m = { t: 16, r: 12, b: 30, l: 46 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Age at which money runs out' }, container);
    const ages = res.failHist.map(h => h.age), a0 = Math.min(...ages), a1 = Math.max(...ages);
    const byAge = new Map(res.failHist.map(h => [h.age, h]));
    const n = a1 - a0 + 1;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const slot = pw / n, bw = Math.min(24, Math.max(2, slot - 2));
    const maxShare = Math.max(...res.failHist.map(h => h.share));
    const ticks = niceTicks(maxShare * 100 * 1.05, 3);
    const ymax = ticks[ticks.length - 1] / 100;
    const dec = ticks.length > 1 ? Math.max(0, -Math.floor(Math.log10(ticks[1]))) : 0;
    const sy = v => m.t + ph - (v / ymax) * ph;
    for (const t of ticks) {
      el('line', { x1: m.l, x2: W - m.r, y1: sy(t / 100), y2: sy(t / 100), class: t === 0 ? 'axis' : 'grid' }, svg);
      text(svg, m.l - 6, sy(t / 100) + 4, `${t.toFixed(dec)}%`, 'tick', { 'text-anchor': 'end' });
    }
    const xs = [1, 2, 5, 10, 20].find(step => step * slot >= 36) || 20;
    for (let a = Math.ceil(a0 / xs) * xs; a <= a1; a += xs) text(svg, m.l + (a - a0 + 0.5) * slot, H - m.b + 16, String(a), 'tick', { 'text-anchor': 'middle' });
    text(svg, W - m.r, H - 4, 'Age money runs out', 'tick', { 'text-anchor': 'end' });
    const tip = tooltip(container);
    for (let a = a0; a <= a1; a++) {
      const h = byAge.get(a); if (!h) continue;
      const x = m.l + (a - a0) * slot + (slot - bw) / 2;
      const bar = el('path', { d: vBar(x, bw, sy(0), sy(h.share), 4), class: 'bar' }, svg);
      const hitr = el('rect', { x: m.l + (a - a0) * slot, y: m.t, width: slot, height: ph, fill: 'transparent' }, svg);
      const show = e => {
        bar.classList.add('hover');
        const r = svg.getBoundingClientRect();
        tip.show(tipRows(`Age ${a}`, [{ label: 'of simulations run out here', value: `${(h.share * 100).toFixed(1)}%` }, { label: 'paths', value: h.count.toLocaleString() }]),
          (x + bw / 2) * r.width / W, e.clientY - r.top);
      };
      hitr.addEventListener('pointermove', show);
      hitr.addEventListener('pointerleave', () => { bar.classList.remove('hover'); tip.hide(); });
    }
    return svg;
  }

  // -------------------------------------------------------------- tornado
  // rows: [{label, lo, hi, base, delta, unit}] sorted by impact
  function tornado(container, rows) {
    container.querySelectorAll('svg, .empty').forEach(s => s.remove());
    const W = Math.max(280, container.clientWidth || 500), rowH = 34, m = { t: 22, r: 56, b: 8, l: 150 };
    const H = m.t + rows.length * rowH + m.b;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Sensitivity of success rate to each input' }, container);
    const base = rows.length ? rows[0].base : 0.5;
    let dev = 0.02;
    for (const r of rows) dev = Math.max(dev, Math.abs(r.lo - base), Math.abs(r.hi - base));
    dev = Math.min(dev * 1.1, Math.max(base, 1 - base));
    const pw = W - m.l - m.r;
    const sx = v => m.l + (v - (base - dev)) / (2 * dev) * pw;
    const cx = sx(base);
    text(svg, cx, 14, `Base ${fmtPct(base)}`, 'tick', { 'text-anchor': 'middle' });
    el('line', { x1: cx, x2: cx, y1: m.t - 4, y2: H - m.b, class: 'axis' }, svg);
    const tip = tooltip(container);
    rows.forEach((r, i) => {
      const y = m.t + i * rowH, bh = 12;
      text(svg, m.l - 10, y + rowH / 2 + 4, r.label, 'label', { 'text-anchor': 'end' });
      const sign = (r.unit === 'yr' || r.unit === 'pts') ? `±${r.delta} ${r.unit}` : `±${r.delta}%`;
      text(svg, m.l - 10, y + rowH / 2 + 16, sign, 'tick', { 'text-anchor': 'end' });
      const seg = (v, yy, tag) => {
        const cls = v >= base ? 'bar-up' : 'bar-down';
        const d = hBar(cx, sx(v), yy, bh, 4);
        if (d) el('path', { d, class: cls }, svg);
        const lx = v >= base ? sx(v) + 6 : sx(v) - 6;
        text(svg, lx, yy + bh - 2, fmtPct(v), 'tick', { 'text-anchor': v >= base ? 'start' : 'end' });
        const hitr = el('rect', { x: m.l, y: yy - 1, width: pw, height: bh + 2, fill: 'transparent' }, svg);
        hitr.addEventListener('pointermove', e => {
          const rr = svg.getBoundingClientRect();
          const dpts = Math.round((v - base) * 100);
          tip.show(tipRows(`${r.label} ${tag}`, [{ label: 'success rate', value: fmtPct(v) }, { label: 'vs base', value: `${dpts >= 0 ? '+' : ''}${dpts} pts` }]),
            (e.clientX - rr.left), (e.clientY - rr.top));
        });
        hitr.addEventListener('pointerleave', () => tip.hide());
      };
      const lowerTag = (r.unit === 'yr' || r.unit === 'pts') ? `−${r.delta} ${r.unit}` : `−${r.delta}%`;
      const upperTag = (r.unit === 'yr' || r.unit === 'pts') ? `+${r.delta} ${r.unit}` : `+${r.delta}%`;
      seg(r.lo, y + 3, lowerTag);
      seg(r.hi, y + 3 + bh + 2, upperTag);
    });
    return svg;
  }

  return { fan, failHist, tornado, fmtMoney, fmtPct };
})();
