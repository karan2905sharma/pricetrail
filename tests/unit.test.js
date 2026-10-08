const fs = require('fs'); const { JSDOM } = require('jsdom');
const P = require('path').join(__dirname, '..', 'extension', 'lib') + '/';
const lib = ['sites.js','extract.js','match.js','util.js'].map(f => fs.readFileSync(P+f,'utf8')).join('\n');
const F = (n) => fs.readFileSync(__dirname + '/fixtures/' + n, 'utf8');
function dom(html, url) { const d = new JSDOM(html, { url, runScripts: 'outside-only' }); d.window.eval(lib); return d.window; }
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

let w = dom(F('amazon_product.html'), 'https://www.amazon.in/Apple-iPhone-15-128-GB/dp/B0CHX1W1XY/ref=sr_1_1?crid=x');
let p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
console.log(p);
ok(p && p.price === 69900 && p.key === 'amazon:B0CHX1W1XY' && p.url === 'https://www.amazon.in/dp/B0CHX1W1XY', 'amazon product price/key/url');
ok(p.mrp === 79900 && /71657TiFeHL/.test(p.image) && p.title === 'Apple iPhone 15 (128 GB) - Black', 'amazon mrp/image/title');

w = dom(F('flipkart_product.html'), 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W&lid=LSTMOB&marketplace=FLIPKART');
p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
console.log(p);
ok(p && p.price === 64999 && p.key === 'flipkart:MOBGTAGPTB3VS24W' && p.url.endsWith('?pid=MOBGTAGPTB3VS24W'), 'flipkart product');
// selectors broken -> JSON-LD fallback
w.document.querySelectorAll('.Nx9bqj').forEach(e => e.className = 'zz');
p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
ok(p && p.price === 64999 && p.source === 'json-ld', 'flipkart falls back to JSON-LD: ' + (p && p.source));
// JSON-LD removed too -> heuristic (first price after h1)
w.document.querySelector('#jsonLD').remove();
p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
ok(p && p.price === 64999 && p.source === 'heuristic', 'flipkart falls back to ₹ heuristic: ' + (p && p.price));
// stale JSON-LD from SPA navigation must not be trusted
w = dom(F('flipkart_product.html').replace('Apple iPhone 15 (Black, 128 GB)","image', 'Samsung Galaxy S24 Ultra (Titanium, 512 GB)","image').replace(/class="Nx9bqj CxhGGd"/, 'class="q"'), 'https://www.flipkart.com/x/p/itm6ac6485515ae4?pid=MOBGTAGPTB3VS24W');
p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
ok(p && p.source !== 'json-ld' && p.price === 64999, 'stale JSON-LD ignored (source=' + (p && p.source) + ', price=' + (p && p.price) + ')');

const src = 'Apple iPhone 15 (128 GB) - Black';
function best(res) { return res.items.map(i => ({ ...i, s: w.PTMatch.score(src, i.title) })).sort((a, b) => b.s - a.s)[0]; }

w = dom(F('amazon_search.html'), 'https://www.amazon.in/s?k=Apple+iPhone+15+128+GB');
let r = w.PTExtract.extractSearchResults(w.document, 'amazon', w.location.href);
console.log(r.layer, r.items.map(i => [i.price, i.sponsored, i.title.slice(0, 50)]));
let b = best(r);
ok(r.layer === 'site' && r.items.length === 4 && b.price === 69900 && b.url === 'https://www.amazon.in/dp/B0CHX1W1XY' && b.s >= 0.6, 'amazon search best match ' + b.s);

w = dom(F('flipkart_search.html'), 'https://www.flipkart.com/search?q=Apple+iPhone+15+128+GB');
r = w.PTExtract.extractSearchResults(w.document, 'flipkart', w.location.href);
console.log(r.layer, r.items.map(i => [i.price, i.title, i.url.slice(0, 60)]));
b = best(r);
ok(r.layer === 'anchors' && r.items.length === 4 && b.price === 64999 && /pid=MOBGTAGPTB3VS24W/.test(b.url) && b.s >= 0.6, 'flipkart search via anchors ' + b.s);
ok(r.items.every(i => !/40,000/.test(String(i.price))), 'exchange offer amount ignored');

w = dom(F('croma_search.html'), 'https://www.croma.com/searchB?q=x');
r = w.PTExtract.extractSearchResults(w.document, 'croma', w.location.href);
console.log(r.layer, r.items);
b = best(r);
ok(r.layer === 'embedded-json' && b.price === 66990 && b.url === 'https://www.croma.com/apple-iphone-15-128gb-black-/p/300652' && b.s >= 0.6, 'croma embedded JSON ' + b.s);

w = dom(F('blocked.html'), 'https://www.reliancedigital.in/products?q=x');
r = w.PTExtract.extractSearchResults(w.document, 'reliance', w.location.href);
ok(r.blocked === true, 'access-denied page detected as blocked');

// identify edge cases
const id = (u) => { const x = w.PTSites.identify(u); return x && x.key; };
ok(id('https://www.amazon.in/gp/product/B0CHX1W1XY?th=1') === 'amazon:B0CHX1W1XY', 'amazon /gp/product');
ok(id('https://www.amazon.in/s?k=iphone') === null, 'amazon search is not a product');
ok(id('https://www.myntra.com/tshirts/roadster/roadster-men-tshirt/2341234/buy') === 'myntra:2341234', 'myntra');
ok(id('https://www.croma.com/apple-iphone-15-128gb-black-/p/300652') === 'croma:300652', 'croma');
ok(id('https://www.tatacliq.com/apple-iphone-15/p-mp000000019503712') === 'tatacliq:mp000000019503712', 'tatacliq');

// stats
const U = w.PTUtil, D = 864e5, now = Date.now();
let st = U.stats([{ t: now - 40 * D, p: 79900 }, { t: now - 20 * D, p: 72000 }, { t: now - 5 * D, p: 69900 }], 69900);
ok(st.lowest === 69900 && st.highest === 79900 && st.verdict.label === 'Lowest price seen', 'stats lowest verdict');
st = U.stats([{ t: now - 40 * D, p: 65000 }, { t: now - 2 * D, p: 79000 }], 79000);
ok(st.verdict.tone === 'bad', 'stats high verdict');
ok(U.inr(123456) === '₹1,23,456' && U.inr(99.5) === '₹99.5', 'INR formatting ' + U.inr(123456));

// --- fixes from the live-site run ---
w = dom(F('croma_product.html'), 'https://www.croma.com/apple-iphone-15-128gb-black-/p/300652');
p = w.PTExtract.extractProduct(w.document, w.location.href, { live: false });
ok(p && p.price === 66990 && p.source === 'json-ld' && p.key === 'croma:300652', 'croma malformed JSON-LD recovered: ' + (p && p.price));

w = dom(F('amazon_search_split.html'), 'https://www.amazon.in/s?k=x');
r = w.PTExtract.extractSearchResults(w.document, 'amazon', w.location.href);
ok(r.items[0].title === 'Apple iPhone 15 (128 GB) - Blue with Protect+ with AppleCare Services', 'amazon split brand/model title: ' + r.items[0].title);
ok(r.items[1].title === 'Apple iPhone 15 (128 GB) - Blue' && r.items[1].price === 74900, 'amazon empty a-offscreen falls back to a-price-whole');

r = w.PTExtract.searchFromJson(JSON.parse(F('croma_api.json').toString()), 'croma', 'https://www.croma.com/');
ok(r.items.length === 3 && r.items[0].price === 66990 && r.items[0].url === 'https://www.croma.com/apple-iphone-15-128gb-black-/p/300652', 'croma JSON API parsed (' + r.items.length + ' items)');
ok(w.PTMatch.score('Apple iPhone 15 (128 GB) - Blue', 'Apple iPhone 16e 128 GB, White') < 0.48, 'iPhone 16e rejected for iPhone 15');
ok(w.PTMatch.score('Apple iPhone 15 (128 GB) - Blue', 'Apple') < 0.48, 'bare brand title rejected');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
