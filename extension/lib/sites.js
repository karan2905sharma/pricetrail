/* PriceTrail — supported sites.
 * Shared by the content script, the service worker and the offscreen parser,
 * so it must stay plain JS with no DOM or chrome.* calls. */
(function (root) {
  'use strict';

  const enc = encodeURIComponent;

  const SITES = {
    amazon: {
      id: 'amazon',
      name: 'Amazon',
      color: '#f59e0b',
      hosts: ['amazon.in'],
      compareByDefault: true,
      productId(url) {
        const m = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
        return m ? m[1].toUpperCase() : null;
      },
      canonicalUrl(url, id) { return `https://www.amazon.in/dp/${id}`; },
      searchUrl: (q) => `https://www.amazon.in/s?k=${enc(q)}`,
      productLink: /\/dp\/[A-Z0-9]{10}/i,
    },

    flipkart: {
      id: 'flipkart',
      name: 'Flipkart',
      color: '#2874f0',
      hosts: ['flipkart.com'],
      compareByDefault: true,
      productId(url) {
        if (!/\/p\/itm[a-z0-9]+/i.test(url.pathname)) return null;
        return url.searchParams.get('pid') || url.pathname.match(/\/p\/(itm[a-z0-9]+)/i)[1];
      },
      canonicalUrl(url) {
        const pid = url.searchParams.get('pid');
        return `https://www.flipkart.com${url.pathname}${pid ? `?pid=${pid}` : ''}`;
      },
      searchUrl: (q) => `https://www.flipkart.com/search?q=${enc(q)}`,
      productLink: /\/p\/itm[a-z0-9]+/i,
    },

    croma: {
      id: 'croma',
      name: 'Croma',
      color: '#12a89d',
      hosts: ['croma.com'],
      compareByDefault: true,
      productId(url) {
        const m = url.pathname.match(/\/p\/(\d{4,})/);
        return m ? m[1] : null;
      },
      canonicalUrl(url) { return `https://www.croma.com${url.pathname}`; },
      searchUrl: (q) => `https://www.croma.com/searchB?q=${enc(q)}%3Arelevance&text=${enc(q)}`,
      // Croma's search page renders in the browser; its own JSON API returns the same results.
      searchApi: (q) => `https://api.croma.com/searchservices/v1/search?currentPage=0&query=${enc(q)}%3Arelevance&fields=FULL&channel=WEB&spellOpt=DEFAULT`,
      apiBase: 'https://www.croma.com/',
      productLink: /\/p\/\d{4,}/,
    },

    reliance: {
      id: 'reliance',
      name: 'Reliance Digital',
      color: '#e11d48',
      hosts: ['reliancedigital.in'],
      compareByDefault: true,
      productId(url) {
        const m = url.pathname.match(/\/p\/(\d{5,})/) || url.pathname.match(/\/product\/([a-z0-9-]+)/i);
        return m ? m[1] : null;
      },
      canonicalUrl(url) { return `https://www.reliancedigital.in${url.pathname}`; },
      searchUrl: (q) => `https://www.reliancedigital.in/products?q=${enc(q)}`,
      productLink: /\/p\/\d{5,}|\/product\/[a-z0-9-]+/i,
    },

    tatacliq: {
      id: 'tatacliq',
      name: 'Tata CLiQ',
      color: '#a21caf',
      hosts: ['tatacliq.com'],
      compareByDefault: false,
      productId(url) {
        const m = url.pathname.match(/\/p-(mp\d+)/i);
        return m ? m[1].toLowerCase() : null;
      },
      canonicalUrl(url) { return `https://www.tatacliq.com${url.pathname}`; },
      searchUrl: (q) => `https://www.tatacliq.com/search/?searchCategory=all&text=${enc(q)}`,
      productLink: /\/p-mp\d+/i,
    },

    myntra: {
      id: 'myntra',
      name: 'Myntra',
      color: '#ec4899',
      hosts: ['myntra.com'],
      compareByDefault: false,
      productId(url) {
        const m = url.pathname.match(/\/(\d{6,})\/buy/);
        return m ? m[1] : null;
      },
      canonicalUrl(url) { return `https://www.myntra.com${url.pathname}`; },
      searchUrl: (q) => `https://www.myntra.com/${enc(q.trim().replace(/\s+/g, '-'))}?rawQuery=${enc(q)}`,
      productLink: /\/\d{6,}\/buy/,
    },

    ajio: {
      id: 'ajio',
      name: 'AJIO',
      color: '#334155',
      hosts: ['ajio.com'],
      compareByDefault: false,
      productId(url) {
        const m = url.pathname.match(/\/p\/([a-z0-9_]+)/i);
        return m ? m[1] : null;
      },
      canonicalUrl(url) { return `https://www.ajio.com${url.pathname}`; },
      searchUrl: (q) => `https://www.ajio.com/search/?text=${enc(q)}`,
      productLink: /\/p\/\d{6,}_[a-z0-9]+/i,
    },
  };

  function siteForUrl(urlLike) {
    let url;
    try { url = urlLike instanceof URL ? urlLike : new URL(urlLike); } catch (e) { return null; }
    const host = url.hostname.toLowerCase();
    return Object.values(SITES).find((s) => s.hosts.some((h) => host === h || host.endsWith('.' + h))) || null;
  }

  /** Returns { site, id, url } when the URL is a product page we understand. */
  function identify(urlLike) {
    let url;
    try { url = urlLike instanceof URL ? urlLike : new URL(urlLike); } catch (e) { return null; }
    const site = siteForUrl(url);
    if (!site) return null;
    const id = site.productId(url);
    if (!id) return null;
    return { site, id, key: `${site.id}:${id}`, url: site.canonicalUrl(url, id) };
  }

  root.PTSites = { SITES, siteForUrl, identify };
})(typeof globalThis !== 'undefined' ? globalThis : this);
