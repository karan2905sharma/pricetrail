/* PriceTrail — price/title extraction from product pages and search pages.
 * Works on the live page (content script) and on HTML parsed with DOMParser
 * (offscreen document). Layered so that a site redesign degrades gracefully:
 *   site-specific selectors → JSON-LD → meta tags → embedded JSON → ₹ heuristics. */
(function (root) {
  'use strict';

  const PT = {};
  const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT

  /* ---------- small helpers ---------- */

  const clean = (s) => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();
  const txt = (el) => (el ? clean(el.textContent) : '');
  const attr = (el, name) => (el ? el.getAttribute(name) : null);

  /** "₹1,23,456.00" / "Rs. 999" / 1299 → number (or null). */
  PT.parsePrice = function (v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 1e8 ? Math.round(v * 100) / 100 : null;
    const s = clean(v);
    const m =
      s.match(/(?:₹|rs\.?|inr)\s*(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/i) ||
      s.match(/(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    return n > 0 && n < 1e8 ? n : null;
  };

  function absUrl(href, base) {
    if (!href) return null;
    try { return new URL(href, base).href; } catch (e) { return null; }
  }

  /** Text nodes of an element joined with " | " so adjacent numbers never fuse. */
  function chunks(el) {
    const doc = el.ownerDocument;
    const out = [];
    const w = doc.createTreeWalker(el, SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE' || p === 'NOSCRIPT') continue;
      const t = clean(n.nodeValue);
      if (t) out.push(t);
    }
    return out;
  }

  /** Selling price from a block of text: skips "Save ₹x", EMI and coupon amounts,
   *  then takes the lower of the first two remaining amounts (price vs MRP). */
  function priceFromChunks(list) {
    const joined = list.join(' | ').replace(/₹\s*\|\s*/g, '₹');
    const re = /₹\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/g;
    const found = [];
    let m;
    while ((m = re.exec(joined)) && found.length < 6) {
      const before = joined.slice(Math.max(0, m.index - 18), m.index).toLowerCase();
      const after = joined.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
      if (/(save|off|emi|month|coupon|bank|cashback|up ?to|extra|delivery|fee|exchange|worth)/.test(before)) continue;
      if (/^\s*(\/|per|off|\/mo|\/month|emi)/.test(after)) continue;
      const v = PT.parsePrice(m[0]);
      if (v) found.push(v);
    }
    if (!found.length) return null;
    return found.length > 1 ? Math.min(found[0], found[1]) : found[0];
  }

  /* ---------- JSON-LD ---------- */

  /** Top-level {...} substrings of a string, respecting JSON strings. */
  function balancedObjects(text) {
    const out = [];
    let depth = 0, inStr = false, esc = false, start = -1;
    for (let i = 0; i < text.length && out.length < 20; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = depth > 0;
      else if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}' && depth > 0) { depth--; if (depth === 0) out.push(text.slice(start, i + 1)); }
    }
    return out;
  }

  PT.jsonLdNodes = function (doc) {
    const out = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      out.push(n);
      if (n['@graph']) walk(n['@graph']);
      if (n.mainEntity) walk(n.mainEntity);
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      const raw = s.textContent || '';
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {
        const cleaned = raw.replace(/[\u0000-\u001f]+/g, ' ');
        try { data = JSON.parse(cleaned); } catch (e2) {
          // Malformed block (e.g. a stray extra "}"): parse each balanced top-level object instead.
          data = balancedObjects(cleaned).map((t) => { try { return JSON.parse(t); } catch (e3) { return null; } });
        }
      }
      walk(data);
    });
    return out;
  };

  const isType = (n, t) => {
    const ty = n && n['@type'];
    return Array.isArray(ty) ? ty.includes(t) : ty === t;
  };

  function offerPrice(offers) {
    if (!offers) return null;
    const list = Array.isArray(offers) ? offers : [offers];
    const prices = [];
    for (const o of list) {
      if (!o || typeof o !== 'object') continue;
      const spec = Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification;
      const p = PT.parsePrice(o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : spec && spec.price);
      if (p) prices.push(p);
      if (o.offers) { const inner = offerPrice(o.offers); if (inner) prices.push(inner); }
    }
    return prices.length ? Math.min(...prices) : null;
  }

  function ldImage(img) {
    if (!img) return null;
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) return ldImage(img[0]);
    return img.url || img.contentUrl || null;
  }

  function productFromJsonLd(doc) {
    const nodes = PT.jsonLdNodes(doc);
    const prod = nodes.find((n) => isType(n, 'Product') && (n.offers || n.name)) ||
      nodes.find((n) => isType(n, 'ProductGroup'));
    if (!prod) return null;
    let price = offerPrice(prod.offers);
    if (!price && Array.isArray(prod.hasVariant)) price = offerPrice(prod.hasVariant.map((v) => v.offers).filter(Boolean));
    const avail = JSON.stringify(prod.offers || '').toLowerCase();
    return {
      title: clean(prod.name),
      price,
      image: ldImage(prod.image),
      inStock: avail.includes('outofstock') ? false : avail.includes('instock') ? true : null,
    };
  }

  /* ---------- meta tags ---------- */

  function productFromMeta(doc) {
    const meta = (sel) => attr(doc.querySelector(sel), 'content');
    const itemprop = doc.querySelector('[itemprop="price"]');
    const price = PT.parsePrice(
      meta('meta[property="product:price:amount"]') ||
      meta('meta[property="og:price:amount"]') ||
      meta('meta[name="twitter:data1"][content*="₹"]') ||
      (itemprop && (attr(itemprop, 'content') || txt(itemprop)))
    );
    return {
      title: clean(meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]')),
      price,
      image: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'),
    };
  }

  /* ---------- ₹ heuristic for the main price on a product page ---------- */

  const RUPEE_ONLY = /^₹\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?$/;

  function looksStruck(el, live) {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      if (/^(DEL|S|STRIKE)$/.test(e.nodeName)) return true;
      const cls = (e.getAttribute && e.getAttribute('class')) || '';
      if (/strike|mrp|old-?price|was-?price|cut-?price|list-?price/i.test(cls)) return true;
      if (live && root.getComputedStyle) {
        const st = root.getComputedStyle(e);
        if (st && /line-through/.test(st.textDecorationLine || st.textDecoration || '')) return true;
      }
    }
    return false;
  }

  PT.heuristicPrice = function (doc, live) {
    if (!doc.body) return null;
    const cands = [];
    doc.body.querySelectorAll('div,span,strong,b,p,ins,bdi,h2,h3,h4').forEach((el) => {
      if (el.childElementCount > 4) return; // big containers can't be a bare price; skip before reading text
      const t = el.textContent;
      if (!t || t.length > 24 || t.indexOf('₹') === -1) return;
      const c = clean(t);
      if (!RUPEE_ONLY.test(c)) return;
      // keep the deepest element that matches
      for (const ch of el.children) if (RUPEE_ONLY.test(clean(ch.textContent))) return;
      if (el.closest('header,nav,footer,[class*="carousel"],[class*="similar"],[class*="recommend"]')) return;
      if (looksStruck(el, live)) return;
      cands.push(el);
    });
    if (!cands.length) return null;

    if (live && root.getComputedStyle) {
      let best = null; let bestScore = -1;
      for (const el of cands) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const top = r.top + (root.scrollY || 0);
        const size = parseFloat(root.getComputedStyle(el).fontSize) || 12;
        const s = size * (top < 1400 ? 1 : 0.25);
        if (s > bestScore) { bestScore = s; best = el; }
      }
      if (best) return PT.parsePrice(best.textContent);
    }
    // Parsed HTML: first price after the page's <h1>, else the first one.
    const h1 = doc.querySelector('h1');
    if (h1) {
      const after = cands.find((el) => h1.compareDocumentPosition(el) & 4 /* FOLLOWING */);
      if (after) return PT.parsePrice(after.textContent);
    }
    return PT.parsePrice(cands[0].textContent);
  };

  /* ---------- site-specific product extractors ---------- */

  const PRODUCT = {
    amazon(doc) {
      const title = txt(doc.querySelector('#productTitle')) || txt(doc.querySelector('#title'));
      const sels = [
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .apexPriceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#apex_offerDisplay_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#priceblock_dealprice', '#priceblock_ourprice', '#priceblock_saleprice',
        '#price_inside_buybox', '#newBuyBoxPrice', '#kindle-price', '#price',
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-price-whole',
        '#twister-plus-price-data-price', '#attach-base-product-price',
      ];
      let price = null;
      for (const sel of sels) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        price = PT.parsePrice(el.nodeName === 'INPUT' ? attr(el, 'value') : txt(el));
        if (price) break;
      }
      const mrp = PT.parsePrice(txt(doc.querySelector(
        '#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen, #corePrice_desktop .a-text-price .a-offscreen, #corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen')));
      const img = doc.querySelector('#landingImage, #imgBlkFront, #ebooksImgBlkFront, #main-image');
      const avail = txt(doc.querySelector('#availability')).toLowerCase();
      return {
        title, price, mrp,
        image: attr(img, 'data-old-hires') || attr(img, 'src'),
        inStock: /currently unavailable|out of stock/.test(avail) ? false : (avail ? true : null),
      };
    },

    flipkart(doc, live) {
      const h1 = doc.querySelector('h1');
      const title = txt(h1);
      let price = null;
      // Only the big PDP price classes — the bare ones are reused on 'similar products' cards.
      for (const sel of ['div.Nx9bqj.CxhGGd', 'div._30jeq3._16Jk6d', 'div.CxhGGd']) {
        price = PT.parsePrice(txt(doc.querySelector(sel)));
        if (price) break;
      }
      const soldOut = /sold out|currently unavailable|coming soon/i.test(txt(doc.querySelector('div.Z8JjpR, div._16FRp0')));
      return { title, price, inStock: soldOut ? false : null, _needsHeuristic: !price && live };
    },

    croma(doc) {
      return {
        title: txt(doc.querySelector('h1')),
        price: PT.parsePrice(txt(doc.querySelector('#pdp-product-price'))),
        mrp: PT.parsePrice(txt(doc.querySelector('#old-price, .old-price .amount'))),
      };
    },

    myntra(doc) {
      const title = clean(`${txt(doc.querySelector('.pdp-title'))} ${txt(doc.querySelector('.pdp-name'))}`);
      const price = PT.parsePrice(txt(doc.querySelector('.pdp-price strong')) || txt(doc.querySelector('.pdp-price')));
      const mrp = PT.parsePrice(txt(doc.querySelector('.pdp-mrp s')));
      return { title, price, mrp };
    },
  };

  /** Rough "same product?" check used to reject stale JSON-LD on SPA navigations. */
  function similarTitle(a, b) {
    const ta = new Set(clean(a).toLowerCase().split(/\W+/).filter((x) => x.length > 1));
    const tb = clean(b).toLowerCase().split(/\W+/).filter((x) => x.length > 1);
    if (!ta.size || !tb.length) return true;
    const hit = tb.filter((t) => ta.has(t)).length;
    return hit / Math.min(ta.size, tb.length) >= 0.5;
  }

  /**
   * Extract the product on a product page.
   * @returns {null | {siteId,id,key,url,title,price,mrp,image,inStock,currency,source}}
   */
  PT.extractProduct = function (doc, pageUrl, opts) {
    const live = !!(opts && opts.live);
    const ident = root.PTSites.identify(pageUrl);
    if (!ident) return null;
    const out = { siteId: ident.site.id, id: ident.id, key: ident.key, url: ident.url, currency: 'INR' };

    const specific = PRODUCT[ident.site.id] ? PRODUCT[ident.site.id](doc, live) || {} : {};
    const ld = productFromJsonLd(doc) || {};
    const meta = productFromMeta(doc);
    const h1 = txt(doc.querySelector('h1'));

    out.title = specific.title || ld.title || h1 || meta.title || clean(doc.title);
    const ldTrusted = !ld.title || !specific.title || similarTitle(specific.title, ld.title);

    if (specific.price) { out.price = specific.price; out.source = 'site'; }
    else if (ld.price && ldTrusted) { out.price = ld.price; out.source = 'json-ld'; }
    else if (meta.price) { out.price = meta.price; out.source = 'meta'; }
    else {
      const h = PT.heuristicPrice(doc, live);
      if (h) { out.price = h; out.source = 'heuristic'; }
    }

    out.mrp = specific.mrp && out.price && specific.mrp > out.price ? specific.mrp : null;
    out.image = absUrl(specific.image || (ldTrusted && ld.image) || meta.image, ident.url);
    out.inStock = specific.inStock != null ? specific.inStock : ldTrusted ? ld.inStock : null;
    out.title = out.title.replace(/\s*[:|–-]\s*(Buy|Shop) .*$/i, '').replace(/\s*\|\s*(Flipkart|Amazon|Croma).*$/i, '').slice(0, 300);
    return out.title && out.price ? out : null;
  };

  /* ---------- search result pages ---------- */

  PT.isBlocked = function (doc) {
    const title = (doc.title || '').toLowerCase();
    if (/robot check|captcha|are you a human|access denied|request blocked|attention required|just a moment/.test(title)) return true;
    return !!doc.querySelector('form[action*="validateCaptcha"], #captchacharacters, #px-captcha, #challenge-form, #cf-challenge-running');
  };

  const SEARCH = {
    amazon(doc, base) {
      const out = [];
      doc.querySelectorAll('div[data-component-type="s-search-result"][data-asin]').forEach((el) => {
        const asin = attr(el, 'data-asin');
        if (!asin) return;
        const parts = [];
        el.querySelectorAll('h2').forEach((h) => {
          const t = clean(attr(h, 'aria-label') || h.textContent).replace(/^Sponsored Ad\s*[-–]\s*/i, '');
          if (!t) return;
          // Brand line ("Apple") + model line ("iPhone 15 …"), or a model line that already starts with the brand.
          const i = parts.findIndex((p) => t.toLowerCase().startsWith(p.toLowerCase() + ' '));
          if (i >= 0) parts[i] = t;
          else if (!parts.some((p) => p === t || p.toLowerCase().startsWith(t.toLowerCase() + ' '))) parts.push(t);
        });
        let price = null;
        for (const p of el.querySelectorAll('.a-price:not(.a-text-price)')) {
          price = PT.parsePrice(txt(p.querySelector('.a-offscreen')) || txt(p.querySelector('.a-price-whole')));
          if (price) break;
        }
        const sponsored = /sponsored/i.test(txt(el.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, .puis-label-popover')));
        out.push({
          title: parts.join(' '),
          price,
          url: `https://www.amazon.in/dp/${asin}`,
          image: attr(el.querySelector('img.s-image'), 'src'),
          sponsored,
        });
      });
      return out;
    },
  };

  function searchFromJsonLd(doc, base) {
    const out = [];
    for (const n of PT.jsonLdNodes(doc)) {
      if (isType(n, 'ItemList') && Array.isArray(n.itemListElement)) {
        for (const li of n.itemListElement) {
          const it = li.item || li;
          const price = offerPrice(it.offers);
          if (it.name && price) out.push({ title: clean(it.name), price, url: absUrl(it.url || li.url, base), image: ldImage(it.image) });
        }
      } else if (isType(n, 'Product') && n.name) {
        const price = offerPrice(n.offers);
        if (price) out.push({ title: clean(n.name), price, url: absUrl(n.url, base), image: ldImage(n.image) });
      }
    }
    return out;
  }

  /* Many shops ship their search results as JSON inside a <script>
   * (__NEXT_DATA__, __INITIAL_STATE__, __PRELOADED_STATE__, __myx …).
   * Walk it and pick out objects that look like products. */
  const NAME_KEYS = ['name', 'title', 'productName', 'product_name', 'displayName', 'productname', 'modelName', 'brandedTitle'];
  const PRICE_KEYS = ['sellingPrice', 'selling_price', 'finalPrice', 'final_price', 'offerPrice', 'offer_price', 'salePrice',
    'sale_price', 'discountedPrice', 'discounted_price', 'specialPrice', 'special_price', 'effectivePrice', 'currentPrice',
    'current_price', 'price', 'mop', 'discountPrice'];
  const PRICE_INNER = ['value', 'amount', 'effective', 'selling', 'sellingPrice', 'final', 'discounted', 'offer', 'special', 'min', 'decimalValue', 'formattedValue'];
  const URL_KEYS = ['url', 'productUrl', 'product_url', 'pdpUrl', 'landingPageUrl', 'seoUrl', 'canonicalUrl', 'link', 'href', 'slug', 'webURL'];

  function resolvePrice(v, depth) {
    if (v == null) return null;
    if (typeof v === 'number' || typeof v === 'string') return PT.parsePrice(v);
    if (typeof v !== 'object' || depth > 3) return null;
    for (const k of PRICE_INNER) {
      if (v[k] != null) { const p = resolvePrice(v[k], depth + 1); if (p) return p; }
    }
    return null;
  }

  function walkForProducts(node, out, base, site, state, depth) {
    if (!node || typeof node !== 'object' || depth > 16 || state.visited++ > 60000 || out.length > 80) return;
    if (Array.isArray(node)) { for (const x of node) walkForProducts(x, out, base, site, state, depth + 1); return; }
    let name = null;
    for (const k of NAME_KEYS) {
      const v = node[k];
      if (typeof v === 'string' && v.length >= 6 && v.length <= 250 && /[a-z]/i.test(v)) { name = v; break; }
    }
    if (name) {
      let price = null;
      for (const k of PRICE_KEYS) { if (node[k] != null) { price = resolvePrice(node[k], 0); if (price) break; } }
      if (price && price >= 10) {
        let url = null;
        for (const k of URL_KEYS) {
          const v = node[k];
          if (typeof v === 'string' && v.length > 3 && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(v)) { url = absUrl(v, base); if (url) break; }
        }
        out.push({ title: clean(name), price, url, image: null, _linkOk: !!(url && site && site.productLink.test(url)) });
      }
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === 'object') walkForProducts(v, out, base, site, state, depth + 1);
    }
  }

  function jsonBlobs(t) {
    const s = t.trim();
    const out = [];
    if (s[0] === '{' || s[0] === '[') { try { out.push(JSON.parse(s)); return out; } catch (e) { /* fall through */ } }
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try { out.push(JSON.parse(s.slice(i, j + 1))); } catch (e) {
        // window.__X__ = {...}; window.__Y__ = ... → try up to the first "};"
        const k = s.indexOf('};', i);
        if (k > i) { try { out.push(JSON.parse(s.slice(i, k + 1))); } catch (e2) { /* ignore */ } }
      }
    }
    return out;
  }

  function searchFromEmbeddedJson(doc, site, base) {
    const out = [];
    const state = { visited: 0 };
    for (const s of doc.querySelectorAll('script')) {
      const type = (attr(s, 'type') || '').toLowerCase();
      if (type.includes('ld+json')) continue;
      const t = s.textContent || '';
      if (t.length < 300 || !/price/i.test(t)) continue;
      for (const blob of jsonBlobs(t)) walkForProducts(blob, out, base, site, state, 0);
      if (out.length > 80) break;
    }
    const linked = out.filter((x) => x._linkOk);
    return (linked.length >= 2 ? linked : out).map(({ _linkOk, ...x }) => x);
  }

  function searchFromAnchors(doc, site, base) {
    const out = [];
    const done = new Set();
    const pathOf = (h) => { try { return new URL(h, base).pathname; } catch (e) { return h; } };
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = attr(a, 'href');
      if (!site.productLink.test(href)) return;
      const path = pathOf(href);
      if (done.has(path)) return;

      // Climb to the largest ancestor that still holds only this product.
      let card = null;
      for (let c = a, i = 0; c && c.nodeName !== 'BODY' && i < 8; c = c.parentElement, i++) {
        const paths = new Set();
        c.querySelectorAll('a[href]').forEach((x) => { const h = attr(x, 'href'); if (site.productLink.test(h)) paths.add(pathOf(h)); });
        if (paths.size > 1) break;
        card = c;
      }
      if (!card) return;
      const list = chunks(card);
      const price = priceFromChunks(list);
      if (!price) return;
      const img = card.querySelector('img');
      let title = clean(attr(a, 'title') || attr(img, 'alt'));
      if (title.length < 8) {
        title = list
          .filter((t) => t.length >= 10 && t.length <= 220 && /[a-z]{3}/i.test(t) && !/₹|% off|ratings?|reviews?|add to|compare|delivery|offer/i.test(t))
          .sort((x, y) => y.length - x.length)[0] || title;
      }
      if (!title) return;
      done.add(path);
      out.push({ title, price, url: absUrl(href, base), image: attr(img, 'src') || attr(img, 'data-src') });
    });
    return out;
  }

  /** Products from a JSON API response (used for stores whose search page renders client-side). */
  PT.searchFromJson = function (data, siteId, baseUrl) {
    const site = root.PTSites.SITES[siteId];
    const out = [];
    walkForProducts(data, out, baseUrl, site, { visited: 0 }, 0);
    const seen = new Set();
    const items = out
      .filter((x) => x._linkOk || !site)
      .map(({ _linkOk, ...x }) => x)
      .filter((x) => { const k = x.url + '|' + x.title; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 30);
    return { blocked: false, items, layer: 'api' };
  };

  /** @returns {{blocked:boolean, items:Array<{title,price,url,image,sponsored?}>, layer?:string}} */
  PT.extractSearchResults = function (doc, siteId, baseUrl) {
    const site = root.PTSites.SITES[siteId];
    if (!site) return { blocked: false, items: [] };
    if (PT.isBlocked(doc)) return { blocked: true, items: [] };
    const layers = [
      ['site', () => (SEARCH[siteId] ? SEARCH[siteId](doc, baseUrl) : [])],
      ['json-ld', () => searchFromJsonLd(doc, baseUrl)],
      ['anchors', () => searchFromAnchors(doc, site, baseUrl)],
      ['embedded-json', () => searchFromEmbeddedJson(doc, site, baseUrl)],
    ];
    for (const [layer, fn] of layers) {
      let items = [];
      try { items = fn() || []; } catch (e) { items = []; }
      const seen = new Set();
      items = items.filter((x) => {
        if (!x || !x.title || !x.price) return false;
        const k = (x.url || '') + '|' + x.title;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).slice(0, 30);
      if (items.length) return { blocked: false, items, layer };
    }
    return { blocked: false, items: [] };
  };

  root.PTExtract = PT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
