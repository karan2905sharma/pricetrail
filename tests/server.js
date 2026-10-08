/* Local HTTPS server that impersonates the shops, archive.org and Keepa with fixture pages.
 * Chromium is pointed at it with --host-resolver-rules, so the real extension runs unmodified. */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOSTS = ['www.amazon.in', 'www.flipkart.com', 'www.croma.com', 'api.croma.com', 'www.reliancedigital.in',
  'www.tatacliq.com', 'www.myntra.com', 'www.ajio.com', 'web.archive.org', 'graph.keepa.com', 'api.github.com'];

const F = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));

function ensureCert(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
      '-subj', '/CN=pricetrail-test', '-addext', `subjectAltName=${HOSTS.map((h) => 'DNS:' + h).join(',')}`], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const ARCHIVE_CDX = {
  'amazon.in/dp/B0CHX1W1XY*': [['timestamp', 'original'],
    ['20231015083000', 'https://www.amazon.in/dp/B0CHX1W1XY'],
    ['20240312101500', 'http://www.amazon.in:80/dp/B0CHX1W1XY/'],
    ['20240520120000', 'https://www.amazon.in/dp/B0CHX1W1XY?th=1'],
    ['20240611090000', 'https://www.amazon.in/dp/B0CHX1W1XY']],
};
const ARCHIVE_PAGES = {
  20231015083000: 'arch_amazon_2023.html',
  20240312101500: 'arch_amazon_2024.html',
  20240520120000: 'arch_amazon_variant.html', // different variant → must be rejected
  20240611090000: 'arch_captcha.html', // captcha capture → must be rejected
};

function route(host, u, state) {
  const html = (file) => ({ file, type: 'text/html; charset=utf-8' });
  switch (host) {
    case 'www.amazon.in':
      if (u.pathname === '/s') return html('amazon_search.html');
      if (/\/dp\//.test(u.pathname)) return html('amazon_product.html');
      break;
    case 'www.flipkart.com':
      if (u.pathname === '/search') return html('flipkart_search.html');
      if (/\/p\/itm/.test(u.pathname)) return html('flipkart_product.html');
      break;
    case 'www.croma.com':
      if (u.pathname === '/searchB') return html('croma_search.html');
      if (/\/p\/\d+/.test(u.pathname)) return html('croma_product.html');
      break;
    case 'api.croma.com':
      if (u.pathname === '/searchservices/v1/search') return { file: 'croma_api.json', type: 'application/json' };
      break;
    case 'www.reliancedigital.in':
      return html('blocked.html');
    case 'graph.keepa.com':
      return { file: 'keepa.png', type: 'image/png' };
    case 'api.github.com':
      if (/\/releases\/latest$/.test(u.pathname)) {
        return { body: JSON.stringify(state.latestRelease || { tag_name: 'v0.0.1', html_url: 'https://github.com/x/y/releases/tag/v0.0.1' }), type: 'application/json' };
      }
      break;
    case 'web.archive.org':
      if (u.pathname === '/cdx/search/cdx') {
        return { body: JSON.stringify(ARCHIVE_CDX[u.searchParams.get('url')] || []), type: 'application/json' };
      }
      {
        const m = u.pathname.match(/^\/web\/(\d+)id_\//);
        if (m && ARCHIVE_PAGES[m[1]]) return html(ARCHIVE_PAGES[m[1]]);
      }
      break;
    default:
  }
  return null;
}

/** Starts the server on :443. Returns { close, requests, state }. */
function start(tmpDir) {
  const requests = [];
  const state = {};
  const server = https.createServer(ensureCert(tmpDir), (req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const u = new URL(req.url, 'https://' + host);
    const r = route(host, u, state);
    requests.push({ host, path: u.pathname, query: u.search, cookie: !!req.headers.cookie, hit: !!r });
    if (!r) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<title>404</title>'); return; }
    res.writeHead(200, { 'content-type': r.type, 'access-control-allow-origin': '*' });
    res.end(r.body != null ? r.body : F(r.file));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(443, '127.0.0.1', () => resolve({ close: () => server.close(), requests, state }));
  });
}

module.exports = { start, HOSTS };
