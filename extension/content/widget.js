/* PriceTrail — on-page widget, rendered inside a closed Shadow DOM so shop CSS can't touch it. */
(function (root) {
  'use strict';

  const { inr, shortDate, ago, stats, DAY } = root.PTUtil;
  const SITES = root.PTSites.SITES;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (e) { return '#'; } };

  const LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="7" fill="var(--brand)"/><path d="M5.5 15.5l3.6-3.8 3 2.6 5.4-6.3" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.5" cy="8" r="1.7" fill="#fff"/></svg>';
  const ICON = {
    close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    min: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="rotate(180 10 10)"/></svg>',
    refresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8A6 6 0 1 0 16 12" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M16 4v4h-4" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ext: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H4.5v11.5H16V12M11 4h5v5M16 4l-7 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17.5a1.6 1.6 0 0 0 3 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>',
  };

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root {
    --brand: #0f766e; --brand-ink: #ffffff;
    --bg: #ffffff; --surface: #f5f7f8; --ink: #0f1a1c; --muted: #5b6b70; --line: #e3e8ea;
    --good: #15803d; --good-bg: #e6f6ea; --bad: #b42318; --bad-bg: #fdecea; --warn: #9a6700; --warn-bg: #fff4d6; --arch: #d97706;
    --shadow: 0 18px 50px -12px rgba(15, 26, 28, .35), 0 2px 6px rgba(15, 26, 28, .08);
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
    font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink); -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  }
  @media (prefers-color-scheme: dark) {
    .root {
      --brand: #2dd4bf; --brand-ink: #062a27;
      --bg: #12171a; --surface: #1a2125; --ink: #e8eef0; --muted: #93a3a8; --line: #273035;
      --good: #4ade80; --good-bg: rgba(74,222,128,.12); --bad: #f87171; --bad-bg: rgba(248,113,113,.12);
      --warn: #fbbf24; --warn-bg: rgba(251,191,36,.12); --arch: #f59e0b;
      --shadow: 0 18px 50px -12px rgba(0,0,0,.7), 0 2px 6px rgba(0,0,0,.4);
    }
  }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  svg { display: block; }
  a { color: inherit; text-decoration: none; }
  .num { font-variant-numeric: tabular-nums; }

  /* pill */
  .pill {
    display: flex; align-items: center; gap: 9px; height: 40px; padding: 0 14px 0 8px;
    background: var(--bg); border: 1px solid var(--line); border-radius: 999px; box-shadow: var(--shadow);
    max-width: min(420px, calc(100vw - 36px)); transition: transform .15s ease;
  }
  .pill:hover { transform: translateY(-1px); }
  .pill .logo { width: 24px; height: 24px; flex: none; }
  .pill .price { font-weight: 700; font-size: 14px; }
  .pill .msg { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill .msg.good { color: var(--good); font-weight: 600; }
  .pill .msg.bad { color: var(--bad); font-weight: 600; }
  .root[data-open="true"] .pill { display: none; }

  /* panel */
  .panel {
    width: 372px; max-width: calc(100vw - 36px); max-height: calc(100vh - 36px); overflow: auto;
    background: var(--bg); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow);
    display: none; overscroll-behavior: contain;
  }
  .root[data-open="true"] .panel { display: block; animation: rise .18s ease-out; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 12px 10px 10px 14px; background: var(--bg); border-bottom: 1px solid var(--line); }
  header .logo { width: 22px; height: 22px; }
  header .name { font-weight: 750; letter-spacing: -.01em; }
  header .site { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--surface); color: var(--muted); }
  header .sp { flex: 1; }
  .icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: var(--muted); }
  .icon-btn:hover { background: var(--surface); color: var(--ink); }
  .icon-btn svg { width: 17px; height: 17px; }

  .body { padding: 14px; display: grid; gap: 14px; }
  .title { font-size: 12px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
  .hero .now { font-size: 28px; font-weight: 750; letter-spacing: -.02em; line-height: 1; }
  .hero .mrp { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .hero .mrp s { margin-right: 6px; }
  .verdict { text-align: right; max-width: 52%; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; font-weight: 650; font-size: 12px; white-space: nowrap; }
  .badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .badge.good { color: var(--good); background: var(--good-bg); }
  .badge.bad { color: var(--bad); background: var(--bad-bg); }
  .badge.neutral { color: var(--muted); background: var(--surface); }
  .verdict p { margin: 5px 0 0; font-size: 11px; color: var(--muted); }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stat { background: var(--surface); border-radius: 12px; padding: 9px 10px; }
  .stat span { display: block; font-size: 11px; color: var(--muted); }
  .stat b { display: block; font-size: 14px; margin-top: 2px; }
  .stat small { display: block; font-size: 10.5px; color: var(--muted); margin-top: 1px; }
  .stat.low b { color: var(--good); }

  .card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
  .card-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .card-h h3 { margin: 0; font-size: 12.5px; font-weight: 700; }
  .seg { display: inline-flex; background: var(--surface); border-radius: 8px; padding: 2px; }
  .seg button { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px; color: var(--muted); }
  .seg button[aria-pressed="true"] { background: var(--bg); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }

  .chart { position: relative; }
  .chart svg { width: 100%; height: auto; overflow: visible; }
  .chart .tip {
    position: absolute; top: -6px; transform: translate(-50%, -100%); pointer-events: none; white-space: nowrap;
    background: var(--ink); color: var(--bg); font-size: 11px; padding: 5px 8px; border-radius: 8px; opacity: 0; transition: opacity .1s;
  }
  .chart .tip b { font-size: 12px; }
  .note { font-size: 11.5px; color: var(--muted); margin: 8px 0 0; }
  .note button { color: var(--brand); font-weight: 600; font-size: 11.5px; padding: 0; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--muted); margin-top: 6px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
  .legend .own i { border: 1.6px solid var(--brand); width: 7px; height: 7px; }
  .legend .arch i { background: var(--arch); }
  .spin { display: inline-block; width: 10px; height: 10px; border: 1.6px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -1px; margin-right: 6px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .keepa { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 10px; }
  .keepa .kbtn { color: var(--brand); font-weight: 600; font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
  .keepa .kbtn svg { width: 14px; height: 14px; flex: none; }
  .keepa .kimg { margin-top: 8px; background: #fff; border-radius: 10px; padding: 6px; border: 1px solid var(--line); }
  .keepa .kimg img { display: block; width: 100%; height: auto; }
  .keepa small { display: block; font-size: 10.5px; color: var(--muted); margin-top: 4px; }
  .note a { color: var(--brand); font-weight: 600; }

  .callout { display: flex; gap: 8px; align-items: center; padding: 9px 10px; border-radius: 10px; font-weight: 600; font-size: 12.5px; margin-bottom: 8px; }
  .callout.good { color: var(--good); background: var(--good-bg); }
  .callout.neutral { color: var(--muted); background: var(--surface); }
  .rows { display: grid; gap: 2px; }
  .row { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 10px; }
  a.row:hover { background: var(--surface); }
  .row .dot { width: 10px; height: 10px; border-radius: 3px; }
  .row .store { min-width: 0; }
  .row .store b { display: block; font-size: 12.5px; }
  .row .store small { display: block; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .amt { text-align: right; }
  .row .amt b { display: block; font-size: 13.5px; }
  .chip { display: inline-block; font-size: 10.5px; font-weight: 650; padding: 1px 6px; border-radius: 6px; margin-top: 2px; white-space: nowrap; }
  .chip.good { color: var(--good); background: var(--good-bg); }
  .chip.bad { color: var(--bad); background: var(--bad-bg); }
  .chip.warn { color: var(--warn); background: var(--warn-bg); }
  .chip.neutral { color: var(--muted); background: var(--surface); }
  .row .open { display: inline-flex; align-items: center; gap: 4px; color: var(--brand); font-weight: 600; font-size: 12px; }
  .row .open svg { width: 13px; height: 13px; }
  .row.current { background: var(--surface); }
  .skel { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface), var(--line), var(--surface)); background-size: 200% 100%; animation: sh 1.2s linear infinite; }
  @keyframes sh { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .meta { font-size: 11px; color: var(--muted); display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; }
  .meta button { color: var(--brand); font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
  .meta button svg { width: 13px; height: 13px; }

  .track { display: grid; gap: 10px; }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; }
  .switch .lbl { display: flex; align-items: center; gap: 8px; font-weight: 650; }
  .switch .lbl svg { width: 16px; height: 16px; color: var(--brand); }
  .switch input { position: absolute; opacity: 0; pointer-events: none; }
  .switch .knob { width: 38px; height: 22px; border-radius: 999px; background: var(--line); position: relative; transition: background .15s; flex: none; }
  .switch .knob::after { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
  .switch input:checked + .knob { background: var(--brand); }
  .switch input:checked + .knob::after { transform: translateX(16px); }
  .switch input:focus-visible + .knob { outline: 2px solid var(--brand); outline-offset: 2px; }
  .target { display: flex; align-items: center; gap: 8px; }
  .target label { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .field { flex: 1; display: flex; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; background: var(--bg); min-width: 0; }
  .field span { color: var(--muted); }
  .field input { all: unset; flex: 1; min-width: 0; padding: 7px 4px; font-size: 13px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .btn { padding: 7px 12px; border-radius: 10px; background: var(--brand); color: var(--brand-ink); font-weight: 650; font-size: 12.5px; }
  .btn:disabled { opacity: .5; cursor: default; }
  .target[hidden] { display: none; }
  footer { padding: 0 14px 14px; display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--muted); }
  footer a { color: var(--brand); font-weight: 600; display: inline-flex; gap: 4px; align-items: center; }
  footer a svg { width: 12px; height: 12px; }
  `;

  const RANGES = [['1M', 30], ['3M', 90], ['1Y', 365], ['All', 0]];

  function spanText(days) {
    const d = Math.max(1, Math.round(days));
    if (d < 60) return `${d} day${d === 1 ? '' : 's'}`;
    if (d < 730) return `${Math.round(d / 30)} months`;
    return `${(d / 365).toFixed(1).replace(/\.0$/, '')} years`;
  }

  function chart(history, rangeDays) {
    const W = 340, H = 140, L = 4, R = W - 4, T = 16, B = H - 22;
    const now = Date.now();
    const from = rangeDays ? now - rangeDays * DAY : history[0].t;
    let pts = history.filter((p) => p.t >= from);
    const before = [...history].reverse().find((p) => p.t < from);
    if (before) pts.unshift({ t: from, p: before.p, clipped: true });
    if (!pts.length) pts = [history[history.length - 1]];
    const series = [...pts, { t: now, p: pts[pts.length - 1].p, synthetic: true }];
    const t0 = Math.min(series[0].t, now - 6 * 3600e3);
    const t1 = now;
    const prices = series.map((s) => s.p);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    let lo = minP, hi = maxP;
    if (lo === hi) { lo *= 0.94; hi *= 1.06; } else { const pad = (hi - lo) * 0.12; lo -= pad * 1.8; hi += pad; }
    const x = (t) => L + ((R - L) * (t - t0)) / (t1 - t0 || 1);
    const y = (p) => B - ((B - T) * (p - lo)) / (hi - lo || 1);

    // A brand-new product has one observation: draw it as a flat dashed line across the chart.
    const single = series.length <= 2 && t1 - series[0].t < 3600e3;
    let d = `M${x(series[0].t).toFixed(1)},${y(series[0].p).toFixed(1)}`;
    // Holds longer than 45 days between observations are unknown periods: draw them dashed.
    let solid = '', gaps = '';
    for (let i = 1; i < series.length; i++) {
      const x0 = x(series[i - 1].t).toFixed(1), x1 = x(series[i].t).toFixed(1);
      const y0 = y(series[i - 1].p).toFixed(1), y1 = y(series[i].p).toFixed(1);
      d += ` H${x1} V${y1}`;
      const seg = ` M${x0},${y0} H${x1}`;
      if (series[i].t - series[i - 1].t > 45 * DAY && !series[i].synthetic) gaps += seg; else solid += seg;
      solid += ` M${x1},${y0} V${y1}`;
    }
    if (single) { d = `M${L},${y(series[0].p).toFixed(1)} H${R}`; solid = d; }
    const area = single ? '' : `${d} V${B} H${x(series[0].t).toFixed(1)} Z`;
    const real = series.filter((s) => !s.synthetic && !s.clipped);
    const dots = real.length <= 60
      ? real.map((s) => s.src === 'archive'
        ? `<circle cx="${x(s.t).toFixed(1)}" cy="${y(s.p).toFixed(1)}" r="3" fill="var(--arch)" stroke="var(--bg)" stroke-width="1.2"/>`
        : `<circle cx="${x(s.t).toFixed(1)}" cy="${y(s.p).toFixed(1)}" r="2.6" fill="var(--bg)" stroke="var(--brand)" stroke-width="1.6"/>`).join('')
      : '';
    const minY = y(minP).toFixed(1);
    const svg = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history chart">
        <defs><linearGradient id="ptg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--brand)" stop-opacity=".22"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/>
        </linearGradient></defs>
        <line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="var(--line)"/>
        ${minP !== maxP ? `<line x1="${L}" x2="${R}" y1="${minY}" y2="${minY}" stroke="var(--good)" stroke-dasharray="3 4" stroke-width="1" opacity=".8"/>
        <text x="${R}" y="${Number(minY) + 12}" text-anchor="end" font-size="10" fill="var(--good)" font-weight="600">Lowest ${esc(inr(minP))}</text>` : ''}
        ${area ? `<path d="${area}" fill="url(#ptg)"/>` : ''}
        <path d="${solid}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" ${single ? 'stroke-dasharray="5 5"' : ''}/>
        ${gaps ? `<path d="${gaps}" fill="none" stroke="var(--brand)" stroke-width="1.6" stroke-dasharray="2 4" opacity=".7"/>` : ''}
        ${dots}
        <text x="${L}" y="${T - 4}" font-size="10" fill="var(--muted)">${esc(inr(maxP))}</text>
        <text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${esc(shortDate(t0))}</text>
        <text x="${R}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">Today</text>
        <line class="cursor" x1="0" x2="0" y1="${T}" y2="${B}" stroke="var(--muted)" stroke-dasharray="2 3" opacity="0"/>
        <circle class="cursor-dot" r="4" fill="var(--brand)" stroke="var(--bg)" stroke-width="2" opacity="0"/>
        <rect class="hit" x="${L}" y="0" width="${R - L}" height="${H}" fill="transparent"/>
      </svg>`;
    return { svg, series, x, y, t0, t1, W, L, R };
  }

  function create(handlers) {
    const host = document.createElement('pricetrail-widget');
    host.style.cssText = 'all: initial !important; position: static !important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>${CSS}</style><div class="root" data-open="false"></div>`;
    const rootEl = shadow.querySelector('.root');
    (document.body || document.documentElement).appendChild(host);

    const state = { product: null, current: null, compare: null, settings: null, range: 0, open: false, error: null, keepa: false };

    function siteName(id) { return (SITES[id] && SITES[id].name) || id; }

    function cheapestOther() {
      const c = state.compare;
      if (!c || c === 'loading' || !c.results) return null;
      return c.results.filter((r) => r.status === 'match').sort((a, b) => a.item.price - b.item.price)[0] || null;
    }

    function pillHtml(st) {
      const cur = state.current.price;
      const cheap = cheapestOther();
      let msg = '', tone = '';
      if (cheap && cheap.item.price < cur) { msg = `↓ ${inr(cheap.item.price)} on ${cheap.name}`; tone = 'good'; }
      else if (st && st.verdict.tone !== 'neutral') { msg = st.verdict.label; tone = st.verdict.tone; }
      else if (st && st.points > 1) { msg = `Lowest ${inr(st.lowest)}`; }
      else msg = 'Price history';
      return `<button class="pill" part="pill" aria-label="Open PriceTrail">
        <span class="logo">${LOGO}</span><span class="price num">${esc(inr(cur))}</span><span class="msg ${tone}">${esc(msg)}</span></button>`;
    }

    function compareHtml() {
      const c = state.compare;
      const enabled = state.settings ? Object.keys(state.settings.compareSites).filter((k) => state.settings.compareSites[k] && k !== state.current.siteId) : [];
      if (!enabled.length) return `<p class="note">No other stores selected. Pick stores in the PriceTrail popup → Settings.</p>`;
      if (!c || c === 'loading') {
        return `<div class="rows">${enabled.map((id) => `
          <div class="row"><span class="dot" style="background:${esc(SITES[id].color)}"></span>
          <span class="store"><b>${esc(SITES[id].name)}</b><div class="skel" style="width:70%;margin-top:5px"></div></span>
          <span class="amt"><div class="skel" style="width:58px"></div></span></div>`).join('')}</div>
          <div class="meta"><span>Checking other stores…</span></div>`;
      }
      if (c.error) return `<p class="note">Couldn't compare right now (${esc(c.error)}).</p>`;

      const cur = state.current.price;
      const order = { match: 0, similar: 1, nomatch: 2, unavailable: 3, blocked: 4, error: 5 };
      const results = [...c.results].sort((a, b) => order[a.status] - order[b.status] || ((a.item && a.item.price) || 0) - ((b.item && b.item.price) || 0));
      const matches = results.filter((r) => r.status === 'match');
      const cheapest = matches.slice().sort((a, b) => a.item.price - b.item.price)[0];

      let callout = '';
      if (cheapest && cheapest.item.price < cur) {
        const save = cur - cheapest.item.price;
        callout = `<div class="callout good">Cheaper on ${esc(cheapest.name)} — save ${esc(inr(save))} (${Math.round((save / cur) * 100)}%)</div>`;
      } else if (matches.length) {
        callout = `<div class="callout good">${esc(siteName(state.current.siteId))} has the lowest price among ${matches.length + 1} stores found</div>`;
      } else {
        callout = `<div class="callout neutral">No exact match found on other stores yet</div>`;
      }

      const rows = results.map((r) => {
        const dot = `<span class="dot" style="background:${esc(r.color)}"></span>`;
        if (r.status === 'match' || r.status === 'similar') {
          const diff = r.item.price - cur;
          const chip = r.status === 'similar'
            ? '<span class="chip warn">check variant</span>'
            : diff < 0 ? `<span class="chip good">${esc(inr(-diff))} less</span>`
              : diff > 0 ? `<span class="chip bad">${esc(inr(diff))} more</span>` : '<span class="chip neutral">same price</span>';
          return `<a class="row" href="${esc(safeUrl(r.item.url || r.searchUrl))}" target="_blank" rel="noopener noreferrer" title="${esc(r.item.title)}">
            ${dot}<span class="store"><b>${esc(r.name)}</b><small>${esc(r.item.title)}</small></span>
            <span class="amt"><b class="num">${esc(inr(r.item.price))}</b>${chip}</span></a>`;
        }
        const label = {
          nomatch: 'No matching product found',
          unavailable: "Couldn't read this store's results",
          blocked: 'Store asked for a captcha',
          error: `Couldn't reach store${r.detail ? ' · ' + r.detail : ''}`,
        }[r.status];
        return `<div class="row">${dot}<span class="store"><b>${esc(r.name)}</b><small>${esc(label)}</small></span>
          <a class="open" href="${esc(safeUrl(r.searchUrl))}" target="_blank" rel="noopener noreferrer">Search ${ICON.ext}</a></div>`;
      }).join('');

      return `${callout}<div class="rows">
        <div class="row current"><span class="dot" style="background:${esc((SITES[state.current.siteId] || {}).color || '#888')}"></span>
          <span class="store"><b>${esc(siteName(state.current.siteId))}</b><small>This page</small></span>
          <span class="amt"><b class="num">${esc(inr(cur))}</b></span></div>
        ${rows}</div>
        <div class="meta"><span>Searched “${esc(c.query)}” · ${esc(ago(c.at))}</span>
        <button data-act="refresh">${ICON.refresh} Refresh</button></div>`;
    }

    function panelHtml(st) {
      const p = state.product;
      const cur = state.current;
      const hist = p.history || [];
      const rangeBtns = RANGES.map(([label, days]) => `<button data-range="${days}" aria-pressed="${state.range === days}">${label}</button>`).join('');
      const own = hist.filter((h) => h.src !== 'archive');
      const archived = hist.filter((h) => h.src === 'archive');
      const few = hist.length < 2;
      const a = p.archive || null;
      let archiveNote = '';
      if (a && a.status === 'running') archiveNote = '<p class="note"><span class="spin"></span>Looking for older prices on archive.org…</p>';
      else if (a && a.status === 'error') archiveNote = '<p class="note">Couldn\'t reach archive.org for older prices. <button data-act="archive">Try again</button></p>';
      else if (a && a.status === 'done' && !archived.length) {
        archiveNote = a.snapshots
          ? `<p class="note">archive.org has ${a.snapshots} old cop${a.snapshots === 1 ? 'y' : 'ies'} of this page, but none showed a readable price.</p>`
          : '<p class="note">No archived copies of this page on archive.org, so history starts from your visits.</p>';
      }
      const legend = archived.length
        ? `<div class="legend"><span class="own"><i></i>Seen by PriceTrail (${own.length})</span><span class="arch"><i></i>archive.org snapshots (${archived.length})</span></div>`
        : '';
      const keepaBlock = cur.siteId === 'amazon' ? `<div class="keepa">
          ${state.keepa
            ? `<div class="kimg"><img alt="Amazon price history chart from Keepa" referrerpolicy="no-referrer" src="https://graph.keepa.com/pricehistory.png?asin=${esc(encodeURIComponent(cur.id))}&domain=in&range=365&amazon=1&new=1&width=680&height=300"></div>
               <small>Amazon (orange) and third-party new (blue) prices over the last year, from Keepa.</small>`
            : `<button class="kbtn" data-act="keepa">${ICON.ext}Show Amazon's 1-year chart (Keepa)</button>`}
        </div>` : '';
      const trackMeta = p.tracked
        ? `Checked every ${state.settings.checkEveryHours} h in the background${p.lastVia === 'background' ? ` · last ${ago(p.lastChecked)}` : ''}`
        : 'Turn on to check this price in the background and get an alert when it drops.';
      const keepa = cur.siteId === 'amazon'
        ? `<a href="https://keepa.com/#!product/10-${esc(cur.id)}" target="_blank" rel="noopener noreferrer">Older Amazon history on Keepa ${ICON.ext}</a>` : '<span></span>';

      return `<section class="panel" role="dialog" aria-label="PriceTrail price history">
        <header>
          <span class="logo">${LOGO}</span><span class="name">PriceTrail</span>
          <span class="site">${esc(siteName(cur.siteId))}</span><span class="sp"></span>
          <button class="icon-btn" data-act="min" title="Minimise">${ICON.min}</button>
          <button class="icon-btn" data-act="close" title="Hide on this page">${ICON.close}</button>
        </header>
        <div class="body">
          <div class="title">${esc(cur.title)}</div>
          <div class="hero">
            <div><div class="now num">${esc(inr(cur.price))}</div>
              ${cur.mrp ? `<div class="mrp num"><s>${esc(inr(cur.mrp))}</s>${Math.round((1 - cur.price / cur.mrp) * 100)}% off MRP</div>` : ''}</div>
            <div class="verdict"><span class="badge ${st.verdict.tone}">${esc(st.verdict.label)}</span><p>${esc(st.verdict.hint)}</p></div>
          </div>
          <div class="stats">
            <div class="stat low"><span>Lowest</span><b class="num">${esc(inr(st.lowest))}</b><small>${st.lowestAt ? esc(shortDate(st.lowestAt)) : ''}</small></div>
            <div class="stat"><span>Average</span><b class="num">${esc(inr(Math.round(st.average)))}</b><small>time-weighted</small></div>
            <div class="stat"><span>Highest</span><b class="num">${esc(inr(st.highest))}</b><small>since ${esc(shortDate(st.first))}</small></div>
          </div>
          <div class="card">
            <div class="card-h"><h3>Price history</h3><div class="seg" role="group" aria-label="Range">${rangeBtns}</div></div>
            <div class="chart"><div class="svg"></div><div class="tip"></div></div>
            ${legend}
            ${few ? `<p class="note">First price recorded ${esc(ago(hist[0] ? hist[0].t : Date.now()))}. The chart fills in each time you open this product${p.tracked ? ' and every background check' : ' — turn on tracking below to check it automatically'}.</p>` : `<p class="note">${hist.length} price points over ${esc(spanText(st.days))}.</p>`}
            ${archiveNote}
            ${keepaBlock}
          </div>
          <div class="card">
            <div class="card-h"><h3>Price on other stores</h3></div>
            <div class="compare">${compareHtml()}</div>
          </div>
          <div class="card track">
            <label class="switch"><span class="lbl">${ICON.bell} Track this price</span>
              <input type="checkbox" data-act="track" ${p.tracked ? 'checked' : ''}><span class="knob"></span></label>
            <div class="target" ${p.tracked ? '' : 'hidden'}>
              <label for="pt-target">Alert me below</label>
              <span class="field"><span>₹</span><input id="pt-target" inputmode="numeric" placeholder="${esc(Math.round(st.lowest * 0.97))}" value="${p.targetPrice ? esc(p.targetPrice) : ''}"></span>
              <button class="btn" data-act="target">Set</button>
            </div>
            <div class="meta"><span>${esc(trackMeta)}</span></div>
          </div>
        </div>
        <footer>${keepa}<span>History is stored on this device</span></footer>
      </section>`;
    }

    function drawChart() {
      const box = shadow.querySelector('.chart');
      if (!box || !state.product) return;
      const hist = state.product.history && state.product.history.length ? state.product.history : [{ t: Date.now(), p: state.current.price }];
      const c = chart(hist, state.range);
      box.querySelector('.svg').innerHTML = c.svg;
      const svg = box.querySelector('svg');
      const tip = box.querySelector('.tip');
      const cursor = svg.querySelector('.cursor');
      const dot = svg.querySelector('.cursor-dot');
      const hit = svg.querySelector('.hit');
      const move = (ev) => {
        const rect = svg.getBoundingClientRect();
        const sx = ((ev.clientX - rect.left) / rect.width) * c.W;
        const t = c.t0 + ((sx - c.L) / (c.R - c.L)) * (c.t1 - c.t0);
        let pt = c.series[0];
        for (const s of c.series) if (s.t <= t) pt = s;
        const real = [...c.series].reverse().find((s) => s.t <= t && !s.synthetic) || pt;
        const px = c.x(Math.max(c.t0, Math.min(t, c.t1)));
        cursor.setAttribute('x1', px); cursor.setAttribute('x2', px); cursor.setAttribute('opacity', '1');
        dot.setAttribute('cx', px); dot.setAttribute('cy', c.y(pt.p)); dot.setAttribute('opacity', '1');
        tip.innerHTML = `<b>${esc(inr(pt.p))}</b> · ${real.src === 'archive' ? 'archive.org, ' : 'since '}${esc(shortDate(real.t))}`;
        tip.style.left = `${(px / c.W) * 100}%`;
        tip.style.top = `${(c.y(pt.p) / 140) * rect.height - 8}px`;
        tip.style.opacity = '1';
      };
      hit.addEventListener('mousemove', move);
      hit.addEventListener('mouseleave', () => { tip.style.opacity = '0'; cursor.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
    }

    function render() {
      if (!state.product || !state.current) return;
      const hist = state.product.history && state.product.history.length ? state.product.history : [{ t: Date.now(), p: state.current.price }];
      const st = stats(hist, state.current.price);
      const scroll = (shadow.querySelector('.panel') || {}).scrollTop || 0;
      rootEl.setAttribute('data-open', String(state.open));
      rootEl.innerHTML = pillHtml(st) + panelHtml(st);
      const panel = shadow.querySelector('.panel');
      if (panel) panel.scrollTop = scroll;
      drawChart();
    }

    function renderCompareOnly() {
      const box = shadow.querySelector('.compare');
      if (!box) return render();
      box.innerHTML = compareHtml();
      const pill = shadow.querySelector('.pill');
      if (pill) {
        const hist = state.product.history && state.product.history.length ? state.product.history : [{ t: Date.now(), p: state.current.price }];
        pill.outerHTML = pillHtml(stats(hist, state.current.price));
      }
    }

    rootEl.addEventListener('click', (ev) => {
      const t = ev.target.closest('button, [data-act]');
      if (!t) return;
      if (t.classList.contains('pill')) { state.open = true; render(); handlers.onToggle && handlers.onToggle(true); return; }
      const range = t.getAttribute('data-range');
      if (range != null) { state.range = Number(range); render(); return; }
      const act = t.getAttribute('data-act');
      if (act === 'min') { state.open = false; render(); handlers.onToggle && handlers.onToggle(false); }
      else if (act === 'close') { api.destroy(); handlers.onClose && handlers.onClose(); }
      else if (act === 'refresh') { state.compare = 'loading'; renderCompareOnly(); handlers.onRefresh && handlers.onRefresh(); }
      else if (act === 'keepa') { state.keepa = true; render(); }
      else if (act === 'archive') { handlers.onArchive && handlers.onArchive(); }
      else if (act === 'target') {
        const input = shadow.querySelector('#pt-target');
        const v = Number(String(input.value).replace(/[^\d.]/g, ''));
        handlers.onTrack && handlers.onTrack(true, v > 0 ? v : null);
      }
    });
    rootEl.addEventListener('change', (ev) => {
      if (ev.target.matches('input[data-act="track"]')) handlers.onTrack && handlers.onTrack(ev.target.checked, undefined);
    });
    rootEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.id === 'pt-target') shadow.querySelector('[data-act="target"]').click();
      ev.stopPropagation(); // keep shop keyboard shortcuts from firing while typing
    });

    const api = {
      render(next) { Object.assign(state, next); render(); },
      setProduct(product) { state.product = product; render(); },
      setCompare(cmp) { state.compare = cmp; renderCompareOnly(); },
      destroy() { host.remove(); },
      get alive() { return host.isConnected; },
    };
    return api;
  }

  root.PTWidget = { create, chart };
})(typeof globalThis !== 'undefined' ? globalThis : this);
