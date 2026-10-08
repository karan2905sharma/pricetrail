/* End-to-end test: loads the real extension in Chromium, points the shop hostnames at a local
 * fixture server, and checks the whole flow — recording, comparison, archive.org backfill,
 * background checks, alerts, single-page navigation, update notices and the popup.
 *
 *   npm run test:e2e            (needs openssl, permission to bind :443, and Playwright's Chromium)
 *   SCREENSHOTS=1 npm run test:e2e   also writes PNGs to tests/.tmp/shots
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { start, HOSTS } = require('./server');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '.tmp');
const SHOTS = path.join(TMP, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, label, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
}

/** Copy of the extension whose widget uses an open shadow root, so Playwright can click inside it. */
function testBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricetrail-ext-'));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const w = path.join(dir, 'content', 'widget.js');
  fs.writeFileSync(w, fs.readFileSync(w, 'utf8').replace("attachShadow({ mode: 'closed' })", "attachShadow({ mode: 'open' })"));
  return dir;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await start(TMP);
  const ext = testBuild();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pricetrail-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-proxy-server', '--ignore-certificate-errors',
      `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`],
  });
  const shot = async (page, name) => { if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
  const errors = [];

  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const extId = sw.url().split('/')[2];
    check(extId === 'jjjablnnlgmnnekkeedlhopmppplkcgi', 'manifest key gives a fixed extension ID', extId);
    const get = (k) => sw.evaluate(async (k) => (await chrome.storage.local.get('p:' + k))['p:' + k], k);

    // 75 days of earlier visits for the Amazon product
    const D = 864e5, now = Date.now();
    const hist = [[75, 76999], [60, 74999], [44, 72999], [30, 67999], [24, 72999], [12, 71999], [3, 69900]].map(([d, p]) => ({ t: now - d * D, p }));
    await sw.evaluate(async (h) => chrome.storage.local.set({ 'p:amazon:B0CHX1W1XY': {
      key: 'amazon:B0CHX1W1XY', siteId: 'amazon', id: 'B0CHX1W1XY', url: 'https://www.amazon.in/dp/B0CHX1W1XY',
      title: 'Apple iPhone 15 (128 GB) - Black', history: h, firstSeen: h[0].t, tracked: false, viewed: true, lastPrice: 69900 } }), hist);

    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 404/.test(m.text())) errors.push('console: ' + m.text()); });

    // --- Amazon product page: record, compare, archive backfill ---
    await page.goto('https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY/ref=sr_1_1');
    await page.locator('pricetrail-widget .pill').waitFor({ timeout: 10000 });
    await sleep(1500);
    await shot(page, '1-pill.png');
    await page.locator('pricetrail-widget .pill').click();
    await sleep(9000); // comparison + archive.org lookup

    const amz = await get('amazon:B0CHX1W1XY');
    check(amz.lastPrice === 69900 && amz.history.filter((h) => h.src !== 'archive').length === 8, 'visit recorded on top of earlier history');
    const cmp = Object.fromEntries(amz.compare.results.map((r) => [r.siteId, r]));
    check(cmp.flipkart && cmp.flipkart.status === 'match' && cmp.flipkart.item.price === 64999, 'Flipkart matched (HTML search)', cmp.flipkart && cmp.flipkart.status);
    check(cmp.croma && cmp.croma.status === 'match' && cmp.croma.item.price === 66990, 'Croma matched (JSON API)', cmp.croma && cmp.croma.status);
    check(cmp.reliance && cmp.reliance.status === 'blocked', 'blocked store reported as blocked', cmp.reliance && cmp.reliance.status);
    const arch = amz.history.filter((h) => h.src === 'archive').map((h) => h.p);
    check(amz.archive && amz.archive.status === 'done' && amz.archive.checked === 4, 'archive.org lookup finished', amz.archive);
    check(JSON.stringify(arch) === JSON.stringify([79900, 71999]), 'archive prices added; wrong variant and captcha skipped', arch);
    check(server.requests.filter((r) => r.host === 'web.archive.org').every((r) => !r.cookie), 'no cookies sent to archive.org');

    const badge = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: 'https://www.amazon.in/*' }); return chrome.action.getBadgeText({ tabId: t.id }); });
    check(badge === '-7%', 'toolbar badge shows saving', badge);
    const fk = await get('flipkart:MOBGTAGPTB3VS24W');
    check(fk && fk.history.length === 1 && !fk.viewed, 'competitor price recorded passively');

    check((await page.locator('pricetrail-widget .callout').innerText()).includes('Cheaper on Flipkart'), 'widget shows the cheaper store');
    check((await page.locator('pricetrail-widget .legend').innerText()).includes('archive.org snapshots (2)'), 'widget legend shows archive points');
    await page.locator('pricetrail-widget [data-range="0"]').click();
    await sleep(400);
    const box = await page.locator('pricetrail-widget .chart svg').boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await sleep(200);
    check((await page.locator('pricetrail-widget .tip').innerText()).includes('archive.org'), 'chart tooltip names archive.org');
    await shot(page, '2-panel.png');
    await page.locator('pricetrail-widget [data-act="keepa"]').click();
    await sleep(800);
    const kimg = await page.locator('pricetrail-widget .kimg img').evaluate((i) => i.complete && i.naturalWidth);
    check(kimg === 680, 'Keepa chart loads on demand');

    // --- tracking, background check, target alert ---
    const tr = await sw.evaluate(() => HANDLERS.track({ key: 'amazon:B0CHX1W1XY', tracked: true, targetPrice: 70000 }));
    check(tr.product.tracked && tr.product.targetPrice === 70000, 'tracking with target price');
    const run = await sw.evaluate(() => HANDLERS.checkNow());
    check(run.checked === 1 && run.failed === 0, 'background check fetched the product', run);
    const after = await get('amazon:B0CHX1W1XY');
    check(after.lastVia === 'background' && after.lastNotifiedPrice === 69900, 'target-price alert fired');

    // --- single-page navigation (Amazon variant switch) ---
    await page.goto('https://www.amazon.in/dp/B0CHX1W1XY');
    await sleep(3000);
    await page.evaluate(() => {
      history.pushState({}, '', '/dp/B0CHX3QBCH');
      document.querySelector('#productTitle').textContent = 'Apple iPhone 15 (256 GB) - Black';
      document.querySelector('.priceToPay .a-offscreen').textContent = '₹79,900.00';
    });
    await sleep(4500);
    const v = await get('amazon:B0CHX3QBCH');
    check(v && v.lastPrice === 79900, 'variant switch without reload recorded');

    // --- Flipkart page (dark mode) and Croma page (repaired JSON-LD) ---
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W');
    // The panel remembers it was left open, so it opens directly (pill hidden).
    await page.locator('pricetrail-widget .panel').waitFor({ timeout: 10000 });
    await sleep(3500);
    await shot(page, '3-flipkart-dark.png');
    const fk2 = await get('flipkart:MOBGTAGPTB3VS24W');
    check(fk2.viewed && fk2.compare.results.some((r) => r.siteId === 'amazon' && r.status === 'match'), 'Flipkart page compares back to Amazon');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('https://www.croma.com/apple-iphone-15-128gb-black-/p/300652');
    await sleep(3500);
    const cr = await get('croma:300652');
    check(cr && cr.lastPrice === 66990, 'Croma product page read', cr && cr.lastPrice);

    // --- update notice for GitHub installs ---
    server.state.latestRelease = {
      tag_name: 'v9.9.9',
      html_url: 'https://github.com/karan2905sharma/pricetrail/releases/tag/v9.9.9',
      assets: [{ name: 'pricetrail-v9.9.9.zip', browser_download_url: 'https://github.com/karan2905sharma/pricetrail/releases/download/v9.9.9/pricetrail-v9.9.9.zip' }],
    };
    const upd = await sw.evaluate(() => HANDLERS.checkUpdate());
    check(upd.available && upd.latest === '9.9.9' && /pricetrail-v9\.9\.9\.zip$/.test(upd.download), 'newer GitHub release detected', upd);

    const pop = await ctx.newPage();
    pop.on('pageerror', (e) => errors.push('popup: ' + e.message));
    await pop.setViewportSize({ width: 390, height: 640 });
    await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(1000);
    check(await pop.locator('#updateBanner').isVisible(), 'popup shows update banner');
    check((await pop.locator('#updDownload').getAttribute('href')).endsWith('pricetrail-v9.9.9.zip'), 'banner links to the release zip');
    check((await pop.locator('#cntTracked').innerText()) === '1', 'popup lists tracked product');
    await shot(pop, '4-popup.png');
    await pop.click('#toggleSettings');
    await sleep(300);
    await shot(pop, '5-settings.png');

    server.state.latestRelease = { tag_name: 'v1.0.0', html_url: 'x', assets: [] };
    const same = await sw.evaluate(() => HANDLERS.checkUpdate());
    check(!same.available, 'older release is not offered as an update');

    check(errors.length === 0, 'no page or popup errors', errors);
  } catch (e) {
    console.error(e);
    failures++;
  } finally {
    await ctx.close();
    server.close();
    fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
