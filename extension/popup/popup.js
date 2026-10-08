/* PriceTrail — toolbar popup. */
(function () {
  'use strict';

  const { SITES } = self.PTSites;
  const { inr, ago, shortDate, stats, DAY } = self.PTUtil;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch (e) { return '#'; } };

  const full = new URLSearchParams(location.search).has('full');
  if (full) document.body.classList.add('full');

  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r || {})));

  let data = { products: [], lastRun: null, settings: null };
  let tab = 'tracked';

  const BELL = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17.5a1.6 1.6 0 0 0 3 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>';
  const TRASH = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** Last price change: {dir:'down'|'up', amount} or null */
  function lastChange(p) {
    const h = p.history || [];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i].p !== h[i - 1].p) return { dir: h[i].p < h[i - 1].p ? 'down' : 'up', amount: Math.abs(h[i].p - h[i - 1].p), at: h[i].t };
    }
    return null;
  }

  function spark(history) {
    const W = 120, H = 24;
    const h = (history || []).slice(-120);
    if (h.length < 2) return '';
    const now = Date.now();
    const pts = [...h, { t: now, p: h[h.length - 1].p }];
    const t0 = pts[0].t, t1 = now;
    const ps = pts.map((x) => x.p);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const x = (t) => 1 + ((W - 2) * (t - t0)) / (t1 - t0 || 1);
    const y = (p) => (hi === lo ? H / 2 : H - 3 - ((H - 6) * (p - lo)) / (hi - lo));
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].p).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].p).toFixed(1)}`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--brand)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  function itemHtml(p) {
    const site = SITES[p.siteId] || { name: p.siteId, color: '#888' };
    const st = stats(p.history, p.lastPrice);
    const ch = lastChange(p);
    let chip = '';
    if (st && st.points > 1 && p.lastPrice <= st.lowest && st.highest > st.lowest) chip = '<span class="chip good">Lowest</span>';
    else if (ch && ch.dir === 'down') chip = `<span class="chip good">↓ ${esc(inr(ch.amount))}</span>`;
    else if (ch && ch.dir === 'up') chip = `<span class="chip bad">↑ ${esc(inr(ch.amount))}</span>`;
    const thumb = p.image
      ? `<img class="thumb" src="${esc(safeUrl(p.image))}" alt="" referrerpolicy="no-referrer" loading="lazy">`
      : `<div class="thumb ph">${esc((site.name || '?')[0])}</div>`;
    const lowest = st && st.points > 1 ? ` · low ${esc(inr(st.lowest))}` : '';
    return `<li class="item" data-key="${esc(p.key)}">
      ${thumb}
      <a class="t" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">${esc(p.title)}</a>
      <div class="price"><b>${esc(inr(p.lastPrice))}</b></div>
      <div class="sub"><span class="site" style="--c:${esc(site.color)}">${esc(site.name)}</span>
        <span>since ${esc(shortDate(p.firstSeen || (p.history[0] && p.history[0].t) || Date.now()))}${lowest}</span></div>
      <div class="price">${chip}</div>
      <div class="row3">${spark(p.history)}
        ${p.tracked && p.targetPrice ? `<span class="target-tag" title="Alert when the price drops to this">Target ${esc(inr(p.targetPrice))}</span>` : ''}
        ${p.lastError && p.tracked ? `<span class="err" title="${esc(p.lastError)}">check failed</span>` : ''}
        <span class="sp"></span>
        <button class="act ${p.tracked ? 'on' : ''}" data-act="track" title="${p.tracked ? 'Stop tracking' : 'Track price in background'}">${BELL}${p.tracked ? 'Tracking' : 'Track'}</button>
        <button class="act" data-act="remove" title="Remove from PriceTrail">${TRASH}</button>
      </div>
    </li>`;
  }

  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const tracked = data.products.filter((p) => p.tracked);
    const viewed = data.products.filter((p) => p.viewed);
    $('#cntTracked').textContent = tracked.length;
    $('#cntViewed').textContent = viewed.length;
    $('#sumTracked').textContent = tracked.length;
    const weekAgo = Date.now() - 7 * DAY;
    $('#sumDrops').textContent = tracked.filter((p) => { const c = lastChange(p); return c && c.dir === 'down' && c.at > weekAgo; }).length;
    const lr = data.lastRun;
    $('#sumRun').textContent = lr ? `Checked ${ago(lr.at)}${lr.failed ? ` · ${lr.failed} failed` : ''}` : 'Not checked yet';

    let list = tab === 'tracked' ? tracked : viewed;
    if (q) list = list.filter((p) => (p.title || '').toLowerCase().includes(q));
    $('#list').innerHTML = list.map(itemHtml).join('');
    $('#list').querySelectorAll('img.thumb').forEach((img) => img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = 'thumb ph';
      ph.textContent = (img.closest('.item').querySelector('.site').textContent || '?')[0];
      img.replaceWith(ph);
    }, { once: true }));
    const empty = $('#empty');
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = q
        ? '<b>No matches</b>Try a different word.'
        : tab === 'tracked'
          ? '<b>Nothing tracked yet</b>Open a product on Amazon, Flipkart, Croma or Reliance Digital, then switch on “Track this price” in the PriceTrail panel.'
          : '<b>No products yet</b>Open any product page on a supported store — PriceTrail records its price automatically.';
    } else empty.hidden = true;
    $('#search').hidden = (tab === 'tracked' ? tracked : viewed).length < 6;
  }

  function renderUpdate() {
    const repo = self.PTConfig.repo;
    const u = data.update;
    const banner = $('#updateBanner');
    banner.hidden = !u;
    if (u) {
      $('#updLatest').textContent = u.latest;
      $('#updCurrent').textContent = u.current;
      $('#updDownload').href = safeUrl(u.download || u.page);
      $('#updHow').href = `https://github.com/${repo}#updating`;
    }
    $('#verLine').innerHTML = `v${esc(data.version || '')} · <a href="https://github.com/${esc(repo)}" target="_blank" rel="noopener noreferrer">GitHub</a>`;
    $('#setVersion').textContent = data.version || '';
    $('#updatesGroup').hidden = !!data.store; // Chrome Web Store installs update automatically
  }

  function renderSettings() {
    const s = data.settings;
    if (!s) return;
    $('#setInterval').value = String(s.checkEveryHours);
    $('#setAnyDrop').checked = !!s.notifyAnyDrop;
    $('#setArchive').checked = s.archiveLookup !== false;
    $('#setWidget').checked = !!s.showWidget;
    $('#setSites').innerHTML = Object.values(SITES).map((site) =>
      `<label style="--c:${esc(site.color)}"><input type="checkbox" data-site="${esc(site.id)}" ${s.compareSites[site.id] ? 'checked' : ''}>${esc(site.name)}</label>`).join('');
  }

  async function load() {
    const r = await send({ type: 'list' });
    if (r.error) { $('#empty').hidden = false; $('#empty').textContent = r.error; return; }
    data = r;
    renderList();
    renderSettings();
    renderUpdate();
  }

  /* ---- events ---- */

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderList();
  }));
  $('#search').addEventListener('input', renderList);

  $('#list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const key = btn.closest('.item').dataset.key;
    const p = data.products.find((x) => x.key === key);
    if (btn.dataset.act === 'track') {
      const r = await send({ type: 'track', key, tracked: !p.tracked });
      if (r.product) Object.assign(p, r.product);
      renderList();
    } else if (btn.dataset.act === 'remove') {
      await send({ type: 'remove', key });
      data.products = data.products.filter((x) => x.key !== key);
      renderList();
    }
  });

  $('#checkNow').addEventListener('click', async () => {
    const b = $('#checkNow');
    b.disabled = true; b.textContent = 'Checking…';
    const r = await send({ type: 'checkNow' });
    b.disabled = false; b.textContent = 'Check now';
    if (r && !r.error) { data.lastRun = r; await load(); }
  });

  $('#toggleSettings').addEventListener('click', () => {
    const show = $('#settingsView').hidden;
    $('#settingsView').hidden = !show;
    $('#listView').hidden = show;
    $('#toggleSettings').setAttribute('aria-pressed', String(show));
  });
  $('#openTab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1') }));
  if (full) $('#openTab').hidden = true;

  const saveSetting = async (patch) => { const s = await send({ type: 'setSettings', patch }); if (s && !s.error) data.settings = s; };
  $('#setInterval').addEventListener('change', (e) => saveSetting({ checkEveryHours: Number(e.target.value) }));
  $('#setAnyDrop').addEventListener('change', (e) => saveSetting({ notifyAnyDrop: e.target.checked }));
  $('#setWidget').addEventListener('change', (e) => saveSetting({ showWidget: e.target.checked }));
  $('#setArchive').addEventListener('change', (e) => saveSetting({ archiveLookup: e.target.checked }));
  $('#setSites').addEventListener('change', (e) => {
    const id = e.target.dataset.site;
    if (id) saveSetting({ compareSites: { [id]: e.target.checked } });
  });

  $('#checkUpdateBtn').addEventListener('click', async () => {
    const b = $('#checkUpdateBtn');
    b.disabled = true; b.textContent = 'Checking…';
    const r = await send({ type: 'checkUpdate' });
    b.disabled = false; b.textContent = 'Check for updates';
    if (r && r.available) { data.update = r; renderUpdate(); $('#updStatus').textContent = `Version ${r.latest} is available`; }
    else if (r && r.error) $('#updStatus').textContent = "Couldn't reach GitHub — try again later";
    else $('#updStatus').textContent = `You're up to date (v${(r && r.current) || data.version})`;
  });

  const msg = (t) => { $('#dataMsg').textContent = t; };
  $('#exportBtn').addEventListener('click', async () => {
    const r = await send({ type: 'exportData' });
    const blob = new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pricetrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    msg(`Exported ${r.products.length} products.`);
  });
  $('#importBtn').addEventListener('click', () => {
    // The popup closes when a file picker opens, so import from the full-tab view.
    if (!full) { chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?full=1#settings') }); return; }
    $('#importFile').click();
  });
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await send({ type: 'importData', data: JSON.parse(await f.text()) });
      msg(r.error ? r.error : `Imported ${r.added} products.`);
      await load();
    } catch (err) { msg("That file isn't valid JSON."); }
    e.target.value = '';
  });
  let clearArmed = false;
  $('#clearBtn').addEventListener('click', async () => {
    if (!clearArmed) { clearArmed = true; $('#clearBtn').textContent = 'Click again to delete everything'; setTimeout(() => { clearArmed = false; $('#clearBtn').textContent = 'Clear all data'; }, 4000); return; }
    await send({ type: 'clearAll' });
    clearArmed = false; $('#clearBtn').textContent = 'Clear all data';
    msg('All price history deleted.');
    await load();
  });

  if (location.hash === '#settings') $('#toggleSettings').click();
  load().then(() => {
    // Default to "Recently viewed" until something is tracked.
    if (!data.products.some((p) => p.tracked) && data.products.length) document.querySelector('[data-tab="viewed"]').click();
  });
})();
