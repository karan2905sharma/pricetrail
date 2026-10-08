# Chrome Web Store listing — copy/paste sheet

Everything the developer dashboard asks for when you submit PriceTrail. Images are in this folder.

## Store listing tab

**Name** (from the manifest): PriceTrail — Price History & Compare

**Summary** (max 132 characters):
> See price history and compare prices across Amazon, Flipkart, Croma, Reliance Digital & more. Get alerts when prices drop.

**Category:** Shopping  **Language:** English

**Description:**

> Is today's price actually a good deal? PriceTrail answers that on every product page of India's biggest shopping sites.
>
> PRICE HISTORY
> • A chart of how the price has moved, with the lowest, average and highest price
> • A clear verdict: "Lowest price seen", "Good time to buy" or "Price is high"
> • Older prices recovered from archived copies of the page (archive.org), so many products have history from day one
> • Amazon products can also show Keepa's 1-year chart
>
> COMPARE STORES
> • Checks Amazon.in, Flipkart, Croma and Reliance Digital (plus Tata CLiQ, Myntra and AJIO if you switch them on)
> • Matches the exact variant: 128 GB isn't confused with 256 GB, and Pro isn't confused with the base model
> • The toolbar icon shows how much you'd save, e.g. "-7%"
>
> TRACK & ALERT
> • Track any product and set a target price
> • PriceTrail re-checks tracked prices every few hours and notifies you when they drop
>
> PRIVATE BY DESIGN
> • No account, no ads, no analytics, no server — your price history stays in your browser
> • Export, import or delete your data any time
>
> Open source: https://github.com/karan2905sharma/pricetrail

**Images**
- Screenshots (1280×800): `screenshot-1-history.png`, `screenshot-2-compare.png`, `screenshot-3-track.png`
- Small promo tile (440×280): `promo-small-440x280.png`
- Store icon (128×128): `../extension/icons/icon128.png`

**Website / support:** https://github.com/karan2905sharma/pricetrail

## Privacy practices tab

**Single purpose:**
> Shows the price history of the product you are viewing on supported Indian shopping sites and compares its price with the same product on other stores.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the price history, tracked products, target prices and settings locally in the browser. |
| `unlimitedStorage` | Price history for many products over months can exceed the default local storage limit. |
| `alarms` | Schedules the periodic background price checks for products the user chooses to track. |
| `notifications` | Notifies the user when a tracked product's price drops or reaches their target price. |
| `offscreen` | Uses an offscreen document's DOMParser to read prices from fetched product and search pages (service workers have no DOM). |
| Host permissions (amazon.in, flipkart.com, croma.com, reliancedigital.in, tatacliq.com, myntra.com, ajio.com) | Reads the price on the product page the user is viewing, searches the other stores for the same product, and re-checks tracked products. |
| Host permission `api.croma.com` | Croma's search results are only available from its search API, used to compare prices on Croma. |
| Host permission `web.archive.org` | Reads archived copies of a product page to show its older prices. |

**Remote code:** No, I am not using remote code.

**Data usage:** PriceTrail does not collect or transmit user data to the developer; everything stays in `chrome.storage.local`. Leave the data-type boxes unticked and certify the three statements (not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending).

**Privacy policy URL:** https://github.com/karan2905sharma/pricetrail/blob/main/PRIVACY.md
