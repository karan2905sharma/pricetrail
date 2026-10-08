/* PriceTrail — offscreen document: turns fetched HTML into prices with DOMParser.
 * Pages are parsed inertly (scripts never run, images never load). */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  try {
    const doc = new DOMParser().parseFromString(msg.html || '', 'text/html');
    const data = msg.mode === 'product'
      ? self.PTExtract.extractProduct(doc, msg.url, { live: false })
      : self.PTExtract.extractSearchResults(doc, msg.siteId, msg.url);
    sendResponse({ ok: true, data });
  } catch (e) {
    sendResponse({ ok: false, error: String((e && e.message) || e) });
  }
  return false;
});
