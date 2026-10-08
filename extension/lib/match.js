/* PriceTrail — product title matching across shops.
 * Titles differ a lot between shops ("Apple iPhone 15 (128 GB) - Black" vs
 * "Apple iPhone 15 (Black, 128 GB)"), so this scores weighted token overlap
 * and penalises conflicting variants (128GB vs 256GB, Pro vs non-Pro, 15 vs 16). */
(function (root) {
  'use strict';

  const STOP = new Set(('the and with for of in a an to by on at from new latest buy online india best price combo pack set ' +
    'edition version storage rom memory smartphone mobile phone colour color variant model genuine original official ' +
    'warranty year years upto up free get only').split(' '));

  const GENERIC_ALNUM = new Set(['5g', '4g', '3g', '4k', '8k', '2k', '1080p', '720p', '1440p', '2160p', 'usb', 'c', 'wi',
    'wifi6', '1x', '2x', '3x', '24x7', 'v5.3', 'v5.0', 'v5.2', 'bt5.3', 'ip67', 'ip68', 'ip54', 'ipx4', 'ipx5', 'ipx7', 'ai']);

  const VARIANT_WORDS = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'lite', 'fe', 'neo', 'air', 'prime', 'turbo', 'note', 'edge', 'fold', 'flip', 'se']);

  const ACCESSORY = new Set(('case cover tempered glass protector guard charger cable skin strap adapter stand holder pouch ' +
    'sleeve refill replacement spare mount bumper lens tips').split(' '));

  const UNIT_RE = /^(\d+(?:\.\d+)?)(gb|tb|mb|mah|inch|hz|mp|kg|g|ml|l|w|v|ton|star|cm|mm)$/;

  function normalize(s) {
    let t = ' ' + String(s || '').toLowerCase() + ' ';
    t = t.replace(/&/g, ' and ');
    t = t.replace(/(\d)\s*(?:"|''|″|”|inches|inch)(?=[^a-z]|$)/g, '$1inch ');
    t = t.replace(/(\d)\s*(?:litres?|liters?|ltrs?)\b/g, '$1l ');
    t = t.replace(/(\d)\s*(?:gms?|grams?)\b/g, '$1g ');
    t = t.replace(/(\d)\s*watts?\b/g, '$1w ');
    t = t.replace(/(\d(?:\.\d+)?)\s*(gb|tb|mb|mah|hz|khz|ghz|mp|cm|mm|kg|g|ml|l|w|v|ton|star)\b/g, '$1$2 ');
    t = t.replace(/[^a-z0-9.+]+/g, ' ');
    return t;
  }

  function tokens(s) {
    const out = [];
    const seen = new Set();
    for (let x of normalize(s).split(/\s+/)) {
      x = x.replace(/^[.+]+|[.+]+$/g, '');
      if (!x || STOP.has(x) || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  }

  function weight(t, i) {
    if (/\d/.test(t) && /[a-z]/.test(t)) return GENERIC_ALNUM.has(t) ? 0.5 : 3;
    if (/^\d+$/.test(t)) return 2.5;
    if (i === 0) return 2;
    return 1;
  }

  const isModel = (t) => /\d/.test(t) && /[a-z]/.test(t) && !GENERIC_ALNUM.has(t) && !UNIT_RE.test(t);

  function unitValues(ts) {
    const m = {};
    ts.forEach((t) => { const x = t.match(UNIT_RE); if (x) (m[x[2]] = m[x[2]] || new Set()).add(x[1]); });
    return m;
  }

  function penalty(ta, tb) {
    let p = 1;
    const ua = unitValues(ta);
    const ub = unitValues(tb);
    for (const u in ua) {
      if (!ub[u]) continue;
      const shared = [...ua[u]].some((v) => ub[u].has(v));
      if (!shared) p *= 0.5;
    }
    const ma = ta.filter(isModel);
    const mb = tb.filter(isModel);
    if (ma.length && mb.length && !ma.some((t) => mb.includes(t))) p *= 0.55;

    // Model numbers near the start: "15" vs "16", or "15" vs "16e" (digit-led model tokens count by their number).
    const lead = (t) => { const m = t.match(/^(\d+)[a-z]{0,2}$/); return m && !UNIT_RE.test(t) && !GENERIC_ALNUM.has(t) ? m[1] : null; };
    const na = ta.slice(0, 6).map(lead).filter(Boolean);
    const nb = tb.slice(0, 6).map(lead).filter(Boolean);
    if (na.length && nb.length && !na.some((t) => nb.includes(t))) p *= 0.55;
    // Same number but a letter variant on one side only: "iPhone 16" vs "iPhone 16e"
    const suffixed = (xs, other) => xs.slice(0, 6).some((t) => /^\d+[a-z]{1,2}$/.test(t) && !UNIT_RE.test(t) && !GENERIC_ALNUM.has(t) && !other.has(t) && other.has(t.match(/^\d+/)[0]));
    if (suffixed(ta, new Set(tb)) || suffixed(tb, new Set(ta))) p *= 0.5;

    const headA = new Set(ta.slice(0, 8));
    const headB = new Set(tb.slice(0, 8));
    const allA = new Set(ta);
    const allB = new Set(tb);
    let variantMismatches = 0;
    headA.forEach((t) => { if (VARIANT_WORDS.has(t) && !allB.has(t)) variantMismatches++; });
    headB.forEach((t) => { if (VARIANT_WORDS.has(t) && !allA.has(t)) variantMismatches++; });
    p *= Math.pow(0.45, Math.min(variantMismatches, 2));

    // "Spigen case for Galaxy S24" is not a Galaxy S24
    const accA = ta.some((t) => ACCESSORY.has(t));
    const accB = tb.some((t) => ACCESSORY.has(t));
    if (accA !== accB) p *= 0.4;
    return p;
  }

  /** 0..1 similarity between two product titles. */
  function score(a, b) {
    const ta = tokens(a).slice(0, 26);
    const tb = tokens(b).slice(0, 26);
    if (!ta.length || !tb.length) return 0;
    const setA = new Set(ta);
    const setB = new Set(tb);
    let wA = 0, wB = 0, hitA = 0, hitB = 0;
    ta.forEach((t, i) => { const w = weight(t, i); wA += w; if (setB.has(t)) hitA += w; });
    tb.forEach((t, i) => { const w = weight(t, i); wB += w; if (setA.has(t)) hitB += w; });
    const covA = hitA / wA;
    const covB = hitB / wB;
    // brand (first token) mismatch is a strong signal
    const brandOk = setB.has(ta[0]) || setA.has(tb[0]);
    let s = 0.65 * Math.max(covA, covB) + 0.35 * Math.min(covA, covB);
    if (!brandOk) s *= 0.6;
    // A two-word title ("Apple", "Samsung Galaxy") can't confirm a specific product.
    if (ta.length <= 2 || tb.length <= 2) s *= 0.5;
    s *= penalty(ta, tb);
    return Math.round(s * 100) / 100;
  }

  /** Short search query from a long shop title. */
  function searchQuery(title) {
    const full = String(title || '').replace(/\s+/g, ' ').trim();
    const caps = [];
    for (const t of tokens(full)) {
      const m = t.match(/^(\d+(?:\.\d+)?)(gb|tb|inch|l|kg|ton)$/);
      if (m && caps.length < 2) caps.push(`${m[1]} ${m[2] === 'inch' ? 'inch' : m[2].toUpperCase()}`);
    }
    let main = full.split(/\s[|–—]\s|\s-\s|,|\(|\[|\swith\s/i)[0];
    let words = main.split(' ').filter(Boolean);
    if (words.length < 3) words = full.replace(/[()[\],|]/g, ' ').split(/\s+/).filter(Boolean);
    let q = words.slice(0, 7).join(' ');
    const qn = normalize(q).replace(/\s+/g, '');
    for (const c of caps) if (!qn.includes(normalize(c).replace(/\s+/g, ''))) q += ' ' + c;
    return q.trim();
  }

  root.PTMatch = { tokens, score, searchQuery, normalize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
