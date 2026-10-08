/* PriceTrail — formatting and price-history statistics (shared by widget & popup). */
(function (root) {
  'use strict';

  const DAY = 86400000;

  function inr(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: n % 1 ? 2 : 0 });
  }

  function shortDate(t) {
    return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function ago(t) {
    const d = Date.now() - t;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < DAY) return Math.round(d / 3600000) + ' h ago';
    if (d < 30 * DAY) return Math.round(d / DAY) + ' d ago';
    return shortDate(t);
  }

  /** Stats over a history of {t, p} points (sorted by time). */
  function stats(history, current) {
    const h = (history || []).filter((x) => x && x.p > 0);
    if (!h.length) return null;
    const ps = h.map((x) => x.p);
    const cur = current || ps[ps.length - 1];
    const lowest = Math.min(...ps, cur);
    const highest = Math.max(...ps, cur);

    // time-weighted average: each price counts for as long as it lasted
    let area = 0, span = 0;
    for (let i = 0; i < h.length; i++) {
      const end = i + 1 < h.length ? h[i + 1].t : Date.now();
      const dt = Math.max(end - h[i].t, 1);
      area += h[i].p * dt; span += dt;
    }
    const average = span ? area / span : cur;
    const first = h[0].t;
    const days = (Date.now() - first) / DAY;
    const lowestAt = [...h].reverse().find((x) => x.p === lowest);

    let verdict;
    if (h.length < 2 || days < 2) verdict = { label: 'Tracking started', tone: 'neutral', hint: 'History builds as prices are checked.' };
    else if (cur <= lowest) verdict = { label: 'Lowest price seen', tone: 'good', hint: 'Cheapest it has been since tracking began.' };
    else {
      const pos = highest > lowest ? (cur - lowest) / (highest - lowest) : 0;
      if (pos <= 0.25) verdict = { label: 'Good time to buy', tone: 'good', hint: 'Near the bottom of its range.' };
      else if (pos >= 0.7) verdict = { label: 'Price is high', tone: 'bad', hint: 'It has been noticeably cheaper — consider waiting.' };
      else verdict = { label: 'Average price', tone: 'neutral', hint: 'Middle of its usual range.' };
    }
    return { current: cur, lowest, highest, average, first, days, points: h.length, lowestAt: lowestAt ? lowestAt.t : null, verdict };
  }

  function pctChange(from, to) {
    if (!from || !to) return 0;
    return Math.round(((to - from) / from) * 1000) / 10;
  }

  root.PTUtil = { inr, shortDate, ago, stats, pctChange, DAY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
