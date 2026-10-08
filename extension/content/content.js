/* PriceTrail — content script: reads the product on the page, records its price,
 * shows the widget and asks the service worker to compare other stores. */
(function () {
  'use strict';
  if (window.__priceTrailLoaded) return;
  window.__priceTrailLoaded = true;

  let widget = null;
  let currentKey = null;
  let current = null;
  let hiddenKey = null;
  let lastHref = location.href;
  let runToken = 0;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(res || { error: 'No response' });
        });
      } catch (e) {
        resolve({ error: String(e) }); // extension was reloaded; page needs a refresh
      }
    });
  }

  function teardown() {
    if (widget) widget.destroy();
    widget = null;
    currentKey = null;
    current = null;
  }

  async function run(attempt) {
    const token = ++runToken;
    const ident = self.PTSites.identify(location.href);
    if (!ident) { teardown(); return; }

    const info = self.PTExtract.extractProduct(document, location.href, { live: true });
    if (!info) {
      // Price often renders late on single-page shops — retry for ~12 s.
      if (attempt < 10) setTimeout(() => { if (token === runToken) run(attempt + 1); }, 1200);
      return;
    }
    if (info.key === currentKey && widget && widget.alive && current && current.price === info.price) return;
    if (info.key !== currentKey) teardown();
    currentKey = info.key;
    current = info;

    const res = await send({ type: 'seen', product: info });
    if (token !== runToken || !res || res.error) return;
    const { product, settings } = res;
    if (!settings.showWidget || hiddenKey === info.key) return;

    if (!widget || !widget.alive) {
      widget = self.PTWidget.create({
        onToggle(open) { send({ type: 'setSettings', patch: { widgetOpen: open } }); },
        onClose() { hiddenKey = currentKey; widget = null; },
        async onTrack(tracked, targetPrice) {
          const r = await send({ type: 'track', key: currentKey, tracked, targetPrice });
          if (r && r.product && widget) widget.setProduct(r.product);
        },
        async onArchive() {
          const r = await send({ type: 'archive', key: currentKey });
          if (r && r.product && widget) widget.setProduct(r.product);
        },
        async onRefresh() {
          const r = await send({ type: 'compare', product: current, force: true });
          if (widget && current && current.key === info.key) widget.setCompare(r && !r.error ? r : { error: (r && r.error) || 'failed' });
        },
      });
    }
    widget.render({ product, current: info, settings, open: !!settings.widgetOpen, compare: 'loading' });

    const cmp = await send({ type: 'compare', product: info });
    if (token !== runToken || !widget || currentKey !== info.key) return;
    widget.setCompare(cmp && !cmp.error ? cmp : { error: (cmp && cmp.error) || 'failed' });
  }

  // The service worker pushes updates (e.g. older prices found on archive.org).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'pt:product' && msg.product && widget && widget.alive && msg.product.key === currentKey) {
      widget.setProduct(msg.product);
    }
  });

  // Shops like Flipkart and Amazon change product (or variant) without a page load.
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    setTimeout(() => run(0), 1800);
  }, 800);

  // Same URL but a different price (e.g. size picker) → refresh quietly.
  setInterval(() => {
    if (!current || document.hidden) return;
    const info = self.PTExtract.extractProduct(document, location.href, { live: true });
    if (info && info.key === current.key && info.price !== current.price) run(0);
  }, 5000);

  run(0);
})();
