/* PriceTrail — service worker.
 * Owns storage, cross-store comparison, scheduled price checks and alerts.
 * HTML is parsed in an offscreen document because service workers have no DOMParser. */
importScripts('lib/config.js', 'lib/sites.js', 'lib/extract.js', 'lib/match.js', 'lib/util.js');

const { SITES, identify } = self.PTSites;
const { inr, DAY } = self.PTUtil;

const DEFAULTS = {
  checkEveryHours: 6,
  compareSites: Object.fromEntries(Object.values(SITES).map((s) => [s.id, !!s.compareByDefault])),
  notifyAnyDrop: true,
  archiveLookup: true,
  showWidget: true,
  widgetOpen: false,
};

const ALARM = 'pt-check';
const COMPARE_TTL = 3 * 3600e3;
const HISTORY_CAP = 1500;
const MATCH_SAME = 0.6;
const MATCH_SIMILAR = 0.48;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pkey = (k) => 'p:' + k;

/* ---------------- storage ---------------- */

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  return { ...DEFAULTS, ...s, compareSites: { ...DEFAULTS.compareSites, ...(s.compareSites || {}) } };
}

async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, compareSites: { ...cur.compareSites, ...((patch && patch.compareSites) || {}) } };
  next.checkEveryHours = Math.min(48, Math.max(1, Number(next.checkEveryHours) || DEFAULTS.checkEveryHours));
  await chrome.storage.local.set({ settings: next });
  await scheduleAlarm(next);
  return next;
}

async function getProduct(key) {
  const r = await chrome.storage.local.get(pkey(key));
  return r[pkey(key)] || null;
}

async function putProduct(p) {
  await chrome.storage.local.set({ [pkey(p.key)]: p });
}

async function allProducts() {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all).filter((k) => k.startsWith('p:')).map((k) => all[k]);
}

/**
 * Add a price observation. A new point is stored when the price changes,
 * or once a day while it stays the same (so the chart reaches today).
 */
async function recordPrice(info, via, flags) {
  const now = Date.now();
  let p = await getProduct(info.key);
  const isNew = !p;
  if (!p) {
    p = { key: info.key, siteId: info.siteId, id: info.id, history: [], firstSeen: now, tracked: false, targetPrice: null, viewed: false };
  }
  p.url = info.url || p.url;
  p.title = info.title || p.title;
  p.image = info.image || p.image || null;
  p.mrp = info.mrp || p.mrp || null;
  if (info.inStock != null) p.inStock = info.inStock;
  if (flags && flags.viewed) { p.viewed = true; p.lastViewed = now; }

  const last = p.history[p.history.length - 1]; // history is time-sorted; archive points are always older
  const prevPrice = last ? last.p : null;
  if (!last || last.p !== info.price || now - last.t > DAY) p.history.push({ t: now, p: info.price });
  if (p.history.length > HISTORY_CAP) p.history = p.history.slice(-HISTORY_CAP);

  p.lastPrice = info.price;
  p.lastChecked = now;
  p.lastVia = via;
  p.lastError = null;
  await putProduct(p);
  return { product: p, prevPrice, isNew };
}

/* ---------------- offscreen HTML parsing ---------------- */

// One shared promise, assigned synchronously, so concurrent callers (comparison + archive lookup)
// all wait for the same document to finish loading before messaging it.
let offscreenPromise = null;

function ensureOffscreen() {
  if (!offscreenPromise) {
    offscreenPromise = (async () => {
      if (chrome.runtime.getContexts) {
        const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        if (ctx.length) return;
      }
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['DOM_PARSER'],
          justification: 'Parse product and search pages to read prices',
        });
      } catch (e) {
        if (!/single offscreen/i.test(String((e && e.message) || e))) throw e;
      }
    })().catch((e) => { offscreenPromise = null; throw e; });
  }
  return offscreenPromise;
}

async function parseHtml(mode, html, url, siteId, retries = 3) {
  await ensureOffscreen();
  let res;
  try {
    res = await chrome.runtime.sendMessage({ target: 'offscreen', mode, html, url, siteId });
  } catch (e) {
    // Parser not listening yet (still loading, or Chrome closed it): recreate and retry.
    if (retries > 0 && /receiving end does not exist|could not establish/i.test(String((e && e.message) || e))) {
      offscreenPromise = null;
      await sleep(250);
      return parseHtml(mode, html, url, siteId, retries - 1);
    }
    throw e;
  }
  if (!res || !res.ok) throw new Error((res && res.error) || 'Could not parse page');
  return res.data;
}

/** Keeps the service worker alive during long jobs (Chrome stops idle workers after ~30 s). */
async function keepAlive(job) {
  const t = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  try { return await job(); } finally { clearInterval(t); }
}

async function fetchHtml(url, timeoutMs = 15000, withCookies = true) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      credentials: withCookies ? 'include' : 'omit',
      signal: ctl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-IN,en;q=0.9' },
    });
    return { ok: r.ok, status: r.status, html: await r.text(), finalUrl: r.url || url };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- cross-store comparison ---------------- */

const comparing = new Map();

async function compare(product, force) {
  const stored = await getProduct(product.key);
  const cached = stored && stored.compare;
  if (!force && cached && Date.now() - cached.at < COMPARE_TTL) return cached;
  if (comparing.has(product.key)) return comparing.get(product.key);

  const job = (async () => {
    const settings = await getSettings();
    const query = self.PTMatch.searchQuery(product.title);
    const sites = Object.values(SITES).filter((s) => s.id !== product.siteId && settings.compareSites[s.id]);
    const results = await Promise.all(sites.map((s) => compareOne(s, query, product)));
    const out = { at: Date.now(), query, results };
    const p = await getProduct(product.key);
    if (p) { p.compare = out; await putProduct(p); }
    return out;
  })().finally(() => comparing.delete(product.key));

  comparing.set(product.key, job);
  return job;
}

async function compareOne(site, query, product) {
  const searchUrl = site.searchUrl(query);
  const base = { siteId: site.id, name: site.name, color: site.color, searchUrl };
  try {
    let parsed;
    if (site.searchApi) {
      // Store renders search results client-side: read its JSON API instead of the HTML.
      const res = await fetchHtml(site.searchApi(query));
      if ([403, 429, 503].includes(res.status)) return { ...base, status: 'blocked' };
      if (!res.ok) return { ...base, status: 'error', detail: `HTTP ${res.status}` };
      let data;
      try { data = JSON.parse(res.html); } catch (e) { return { ...base, status: 'unavailable' }; }
      parsed = self.PTExtract.searchFromJson(data, site.id, site.apiBase);
    } else {
      const res = await fetchHtml(searchUrl);
      if ([403, 429, 503].includes(res.status)) return { ...base, status: 'blocked' };
      if (!res.ok) return { ...base, status: 'error', detail: `HTTP ${res.status}` };
      parsed = await parseHtml('search', res.html, res.finalUrl, site.id);
    }
    if (parsed.blocked) return { ...base, status: 'blocked' };
    if (!parsed.items.length) return { ...base, status: 'unavailable' };

    const scored = parsed.items
      .map((it) => ({ ...it, score: Math.max(0, self.PTMatch.score(product.title, it.title) - (it.sponsored ? 0.02 : 0)) }))
      .sort((a, b) => b.score - a.score || a.price - b.price);
    const best = scored[0];
    if (best.score < MATCH_SIMILAR) return { ...base, status: 'nomatch', candidates: scored.slice(0, 3) };

    // Same listing sold by several sellers → take the cheapest of the equally good matches.
    const chosen = scored.filter((x) => x.score >= best.score - 0.05).sort((a, b) => a.price - b.price)[0];
    const status = chosen.score >= MATCH_SAME ? 'match' : 'similar';

    // Passive history: remember what this store charged, so its own page has history later.
    if (status === 'match' && chosen.url) {
      const ident = identify(chosen.url);
      if (ident) {
        recordPrice({ key: ident.key, siteId: ident.site.id, id: ident.id, url: ident.url, title: chosen.title, price: chosen.price, image: chosen.image }, 'compare')
          .catch(() => {});
      }
    }
    return { ...base, status, item: chosen, others: scored.filter((x) => x !== chosen).slice(0, 2) };
  } catch (e) {
    return { ...base, status: 'error', detail: e && e.name === 'AbortError' ? 'Timed out' : String((e && e.message) || e) };
  }
}

function setBadge(tabId, product, result) {
  if (tabId == null || !result || !result.results) return;
  const cheaper = result.results
    .filter((r) => r.status === 'match' && r.item.price < product.price)
    .sort((a, b) => a.item.price - b.item.price)[0];
  if (cheaper) {
    const pct = Math.round((1 - cheaper.item.price / product.price) * 100);
    chrome.action.setBadgeText({ tabId, text: pct >= 1 ? `-${pct}%` : '↓' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
    chrome.action.setTitle({ tabId, title: `Cheaper on ${cheaper.name}: ${inr(cheaper.item.price)}` });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'PriceTrail' });
  }
}

/* ---------------- older prices from archive.org ---------------- */

const ARCHIVE_MAX_SNAPSHOTS = 14;
const archiving = new Map();

/** URL prefixes the Wayback Machine may have captured this product under. */
function archivePrefixes(p) {
  const u = new URL(p.url);
  const host = u.hostname.replace(/^www\./, '');
  if (p.siteId === 'amazon') return [`${host}/dp/${p.id}*`, `${host}/gp/product/${p.id}*`];
  return [`${host}${u.pathname}*`];
}

const waybackTime = (ts) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10) || 0, +ts.slice(10, 12) || 0);

/** Evenly spread picks, always keeping the oldest and newest. */
function spread(list, n) {
  if (list.length <= n) return list;
  const out = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

function tellTab(tabId, product) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'pt:product', product }).catch(() => {});
}

/**
 * Backfill history with prices from Wayback Machine snapshots of the product page.
 * Runs once per product; results are marked src:'archive'.
 */
async function archiveBackfill(key, tabId, force) {
  if (archiving.has(key)) return archiving.get(key);
  const job = keepAlive(async () => {
    let p = await getProduct(key);
    if (!p) return null;
    if (!force && p.archive && p.archive.status !== 'error') return p.archive;
    p.archive = { status: 'running', at: Date.now() };
    await putProduct(p);
    tellTab(tabId, p);

    const result = { status: 'done', at: Date.now(), snapshots: 0, checked: 0, added: 0 };
    const found = [];
    try {
      const rows = [];
      for (const prefix of archivePrefixes(p)) {
        const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(prefix)}&output=json&fl=timestamp,original` +
          '&filter=statuscode:200&filter=mimetype:text/html&collapse=timestamp:6&limit=500';
        const res = await fetchHtml(cdx, 45000, false);
        if (!res.ok) throw new Error(`archive.org HTTP ${res.status}`);
        const data = JSON.parse(res.html || '[]');
        rows.push(...data.slice(1));
      }
      // Only months before PriceTrail's own data, one snapshot per month.
      const own = (p.history || []).filter((h) => h.src !== 'archive');
      const ownFirst = own.length ? own[0].t : Date.now();
      const byMonth = new Map();
      for (const [ts, original] of rows) {
        const t = waybackTime(ts);
        if (t < ownFirst - DAY && !byMonth.has(ts.slice(0, 6))) byMonth.set(ts.slice(0, 6), { ts, t, original });
      }
      const snaps = [...byMonth.values()].sort((a, b) => a.t - b.t);
      result.snapshots = snaps.length;

      for (const s of spread(snaps, ARCHIVE_MAX_SNAPSHOTS)) {
        result.checked++;
        try {
          const orig = /^https?:/i.test(s.original) ? s.original : `https://${s.original}`;
          const res = await fetchHtml(`https://web.archive.org/web/${s.ts}id_/${orig}`, 30000, false);
          if (!res.ok) continue;
          const info = await parseHtml('product', res.html, orig, p.siteId);
          if (!info || !info.price) continue; // captcha pages, app shells, out-of-stock pages
          if (info.title && self.PTMatch.score(p.title, info.title) < 0.55) continue; // a different variant was archived
          found.push({ t: s.t, p: info.price, src: 'archive' });
        } catch (e) { /* skip this snapshot */ }
        await sleep(700);
      }
    } catch (e) {
      result.status = 'error';
      result.error = String((e && e.message) || e);
    }

    p = await getProduct(key);
    if (!p) return null;
    if (found.length) {
      const have = new Set(p.history.map((h) => h.t));
      p.history = [...p.history, ...found.filter((f) => !have.has(f.t))].sort((a, b) => a.t - b.t).slice(-HISTORY_CAP);
      if (!p.firstSeen || found[0].t < p.firstSeen) p.historyFrom = found[0].t;
    }
    result.added = found.length;
    p.archive = result;
    await putProduct(p);
    tellTab(tabId, p);
    return result;
  }).finally(() => archiving.delete(key));
  archiving.set(key, job);
  return job;
}

/* ---------------- scheduled checks & alerts ---------------- */

async function scheduleAlarm(settings) {
  const s = settings || (await getSettings());
  const period = s.checkEveryHours * 60;
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM, { delayInMinutes: Math.min(period, 10), periodInMinutes: period });
  }
}

async function maybeNotify(p, prevPrice, settings) {
  if (!p.tracked) return;
  const price = p.lastPrice;
  let reason = null;
  if (p.targetPrice && price <= p.targetPrice && p.lastNotifiedPrice !== price) {
    reason = `Hit your target of ${inr(p.targetPrice)}`;
  } else if (settings.notifyAnyDrop && prevPrice && price < prevPrice) {
    reason = `Down from ${inr(prevPrice)} (−${Math.round((1 - price / prevPrice) * 100)}%)`;
  }
  if (!reason) return;
  const site = SITES[p.siteId];
  chrome.notifications.create(`pt|${p.key}|${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${inr(price)} · ${p.title.slice(0, 60)}`,
    message: `${reason} on ${site ? site.name : p.siteId}`,
    priority: 1,
  });
  p.lastNotifiedPrice = price;
  await putProduct(p);
}

let checking = null;

async function checkTracked(force) {
  if (checking) return checking;
  checking = keepAlive(async () => {
    const settings = await getSettings();
    const list = (await allProducts()).filter((p) => p.tracked);
    const minGap = settings.checkEveryHours * 3600e3 * 0.5;
    let checked = 0, drops = 0, failed = 0;
    for (const p of list) {
      if (!force && p.lastChecked && Date.now() - p.lastChecked < minGap) continue;
      try {
        const res = await fetchHtml(p.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const info = await parseHtml('product', res.html, p.url, p.siteId);
        if (!info || !info.price) throw new Error('Price not found on page');
        const { product, prevPrice } = await recordPrice({ ...info, key: p.key }, 'background');
        checked++;
        if (prevPrice && product.lastPrice < prevPrice) drops++;
        await maybeNotify(product, prevPrice, settings);
      } catch (e) {
        failed++;
        const cur = await getProduct(p.key);
        if (cur) { cur.lastError = String((e && e.message) || e); cur.lastChecked = Date.now(); await putProduct(cur); }
      }
      await sleep(2000 + Math.random() * 2500); // be gentle with the shops
    }
    const lastRun = { at: Date.now(), checked, drops, failed, total: list.length };
    await chrome.storage.local.set({ lastRun });
    return lastRun;
  }).finally(() => { checking = null; });
  return checking;
}

/* ---------------- update notices (GitHub installs) ---------------- */

const UPDATE_ALARM = 'pt-update-check';

// Chrome Web Store installs carry an update_url and are updated by Chrome itself.
const isStoreInstall = () => !!chrome.runtime.getManifest().update_url;

function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  if (isStoreInstall()) return { current, store: true, available: false };
  try {
    const r = await fetch(`https://api.github.com/repos/${self.PTConfig.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const rel = await r.json();
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    const zip = (rel.assets || []).find((a) => /^pricetrail-v[\d.]+\.zip$/i.test(a.name));
    const { update: prev } = await chrome.storage.local.get('update');
    const info = {
      checkedAt: Date.now(),
      current,
      latest,
      available: !!latest && isNewer(latest, current),
      page: rel.html_url || `https://github.com/${self.PTConfig.repo}/releases/latest`,
      download: zip ? zip.browser_download_url : null,
      notifiedVersion: prev && prev.notifiedVersion,
    };
    if (info.available && info.notifiedVersion !== latest) {
      chrome.notifications.create('pt-update', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `PriceTrail ${latest} is available`,
        message: `You have ${current}. Click to download it — your price history is kept.`,
        priority: 0,
      });
      info.notifiedVersion = latest;
    }
    await chrome.storage.local.set({ update: info });
    return info;
  } catch (e) {
    return { current, available: false, error: String((e && e.message) || e) };
  }
}

async function scheduleUpdateCheck() {
  if (isStoreInstall()) return;
  const existing = await chrome.alarms.get(UPDATE_ALARM);
  if (!existing) await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

/* ---------------- messages ---------------- */

const HANDLERS = {
  async seen({ product }, sender) {
    const { product: p } = await recordPrice(product, 'visit', { viewed: true });
    const settings = await getSettings();
    if (settings.archiveLookup && !p.archive) {
      archiveBackfill(p.key, sender.tab && sender.tab.id).catch(() => {});
      p.archive = { status: 'running', at: Date.now() };
    }
    return { product: p, settings };
  },
  async archive({ key }, sender) {
    archiveBackfill(key, sender.tab && sender.tab.id, true).catch(() => {});
    const p = await getProduct(key);
    return { product: p };
  },
  async compare({ product, force }, sender) {
    const r = await compare(product, force);
    setBadge(sender.tab && sender.tab.id, product, r);
    return r;
  },
  async track({ key, tracked, targetPrice }) {
    const p = await getProduct(key);
    if (!p) return { error: 'Unknown product' };
    if (tracked != null) p.tracked = !!tracked;
    if (targetPrice !== undefined) p.targetPrice = Number(targetPrice) > 0 ? Number(targetPrice) : null;
    if (p.tracked && p.targetPrice && p.lastNotifiedPrice && p.lastNotifiedPrice > p.targetPrice) p.lastNotifiedPrice = null;
    await putProduct(p);
    return { product: p };
  },
  async list() {
    const products = (await allProducts())
      .filter((p) => p.viewed || p.tracked)
      .sort((a, b) => (b.lastViewed || b.lastChecked || 0) - (a.lastViewed || a.lastChecked || 0));
    const { lastRun, update } = await chrome.storage.local.get(['lastRun', 'update']);
    const version = chrome.runtime.getManifest().version;
    return {
      products, lastRun: lastRun || null, settings: await getSettings(), version, store: isStoreInstall(),
      update: update && update.available && isNewer(update.latest, version) ? update : null,
    };
  },
  async remove({ key }) {
    await chrome.storage.local.remove(pkey(key));
    return { ok: true };
  },
  getSettings: () => getSettings(),
  setSettings: ({ patch }) => saveSettings(patch),
  checkNow: () => checkTracked(true),
  checkUpdate: () => checkForUpdate(),
  async exportData() {
    return { app: 'PriceTrail', version: 1, exportedAt: Date.now(), settings: await getSettings(), products: await allProducts() };
  },
  async importData({ data }) {
    if (!data || data.app !== 'PriceTrail' || !Array.isArray(data.products)) return { error: 'Not a PriceTrail export file' };
    let added = 0;
    for (const inc of data.products) {
      if (!inc || !inc.key || !Array.isArray(inc.history)) continue;
      const cur = await getProduct(inc.key);
      if (!cur) { await putProduct(inc); added++; continue; }
      const merged = new Map();
      [...cur.history, ...inc.history].forEach((h) => { if (h && h.t && h.p) merged.set(h.t, h); });
      cur.history = [...merged.values()].sort((a, b) => a.t - b.t).slice(-HISTORY_CAP);
      cur.tracked = cur.tracked || inc.tracked;
      cur.targetPrice = cur.targetPrice || inc.targetPrice || null;
      cur.viewed = cur.viewed || inc.viewed;
      await putProduct(cur);
      added++;
    }
    return { ok: true, added };
  },
  async clearAll() {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('p:') || k === 'lastRun'));
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;
  const handler = HANDLERS[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) checkTracked(false);
  else if (a.name === UPDATE_ALARM) checkForUpdate();
});
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') await chrome.storage.local.remove('update'); // just updated: clear old notice
  scheduleAlarm();
  scheduleUpdateCheck();
});
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); scheduleUpdateCheck(); });

chrome.notifications.onClicked.addListener(async (id) => {
  if (id === 'pt-update') {
    const { update } = await chrome.storage.local.get('update');
    chrome.tabs.create({ url: (update && update.page) || `https://github.com/${self.PTConfig.repo}/releases/latest` });
    chrome.notifications.clear(id);
    return;
  }
  const key = id.split('|')[1];
  const p = key && (await getProduct(key));
  if (p && p.url) chrome.tabs.create({ url: p.url });
  chrome.notifications.clear(id);
});
