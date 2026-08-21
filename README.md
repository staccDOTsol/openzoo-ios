# OpenZoo iOS

OpenZoo on iOS is a **CordovaSeeker** app. First-run is an **App Store paywall**, not Stripe checkout and not a wallet. After a StoreKit 2 purchase the iframe at `www/app/` is a grokui-style chat (threads, composer, attach files). There is no SwiftUI app and no Capacitor project.

This tree started from [FreeSolDev/CordovaSeeker](https://github.com/FreeSolDev/CordovaSeeker) (MIT). Work stays on `staccDOTsol/openzoo-ios`.

## What this is

- Widget id `fun.openzoo.ios`, name **OpenZoo**
- First screen: pick Basic / Pro / Ultra from `GET https://zoo.openzoo.fun/api/billing/tiers`
- Checkout: **StoreKit 2** auto-renewable subscriptions. Product IDs:
  - `fun.openzoo.ios.sub.basic`
  - `fun.openzoo.ios.sub.pro`
  - `fun.openzoo.ios.sub.ultra`
- Restore purchases is on the paywall and in Plan
- After purchase, the app posts the StoreKit JWS to `POST https://zoo.openzoo.fun/api/billing/appstore` to mint the **same subscription key** Stripe checkout would mint on the web. That route is **not on the site yet** — the client stubs it and keeps the JWS so it can retry. Do not open `checkout.stripe.com`. Do not invent a second billing catalog.
- Tagline: *Subscription keys · no x402*. Chat does not lead with Phantom, wrap, or per-call signing.
- Wallet / x402 wrap still exists under **Plan → Advanced** for later. Not first-run.
- Bind is one attach action (photos / files / folder / paste). The UI does not show context ids or bind paths.
- **Chat** still hits `POST https://x402-tokens.fly.dev/v1/chat/completions` (spill + bind + race). That path is unchanged.
- **Agent** cannot run `openzoo-claude` on a phone. It talks to **hosted OCC** on the same zoo origin this app already uses for billing:
  - Origin: `https://zoo.openzoo.fun` (not an open / unauthenticated OCC URL)
  - Every OCC/upload call: `Authorization: Bearer <subscription key>`. No key → no Agent. Never `ANTHROPIC_API_KEY`.
  - IAP (StoreKit) mints that key via `POST /api/billing/appstore`. Debug/sideload may use the `jarettrsdunn1999@gmail.com` bypass to enter the app; Agent still refuses without a key.
  - Store builds stay IAP-only. Agent does not open an in-app x402 pay.
  - Assumed routes (hosted OCC was not merged on the site when this client shipped — align the server to these or change `www/js/occ.js`):
    - `POST /occ/sessions` → `{ id }`
    - `POST /occ/sessions/:id/messages` (SSE) — body `{ text, message, stream: true }` including `/goal`
    - `POST /occ/sessions/:id/files` — multipart `file` or JSON `{ name, content, encoding }`
    - `POST /occ/sessions/:id/stop`
  - Streamed OCC output paints the existing chat bubble (OCC/OpenAI SSE, optional PTY payload). Not a fake `RUN:` parser.

Live web copy (do not invent prices): Basic $9/mo, Pro $29/mo (Most teams want this), Ultra $99/mo. `trialDays` is 0 (`runway_floor`). Usage invoices at $1.00.

## Wallet (optional, not first-run)

`cordova-plugin-mwa` is unused Android code. The shell never calls `MWA.*`. Phantom custom scheme is `phantom://v1/…` (no `ul/`); https is last resort via UIApplication. WKWebView never shows raw “Load failed”. Wallet addresses are tap-to-copy. 402s persist across the wallet background. A labeled **New chat** button sits on the main header.

## Mac build (Xcode required)

iOS 15+ (StoreKit 2). On a Mac:

```bash
npm install
cordova platform add ios && cordova build ios
```

Create the three auto-renewable subscription products in App Store Connect with the IDs above. The Linux VM cannot run StoreKit, the Simulator, or TestFlight.

## Tests

```bash
npm test
```

Parses the live `/supported` fixture (wTOKENx2 / wrap), the `/api/billing/tiers` fixture (prices + App Store product IDs + 404 stub for `/api/billing/appstore`), and the hosted OCC client (Bearer required, SSE paint, no `ANTHROPIC_API_KEY`).

## Layout

```
www/index.html          App Store paywall (iframe host)
www/app/                grokui-style chat / threads / attach
www/js/billing.js       tiers + App Store key-exchange stub
www/js/occ.js           hosted OCC client (Bearer subscription key)
cordova-plugin-openzoo-store/   StoreKit 2
cordova-plugin-openzoo-wallet/  Keychain + canOpenURL
```

## License

MIT.
