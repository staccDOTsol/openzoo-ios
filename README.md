# OpenZoo iOS

OpenZoo on iOS is a **CordovaSeeker** app. The wallet lives in `www/index.html`. The product UI is a bundled iframe at `www/app/` — chat threads, a composer, and attach-files, in the same spirit as the desktop grokui client. There is no SwiftUI app and no Capacitor project.

This tree started from [FreeSolDev/CordovaSeeker](https://github.com/FreeSolDev/CordovaSeeker) (MIT). Work stays on `staccDOTsol/openzoo-ios`. Do not push this product back to CordovaSeeker.

## What this is

- Widget id `fun.openzoo.ios`, name **OpenZoo**
- Custom URL scheme `openzoo` — Phantom redirect `openzoo://phantom`
- Chat against `https://x402-tokens.fly.dev`
- Default chat model: `openai/gpt-4o-mini` (live on `GET /v1/models` when this repo was written)
- Threads, composer, and wallet in the iframe. Attach photos, files, a folder, or pasted text; bind happens in the background. The UI never shows context ids, bind paths, or mint homework.
- Payment is invisible until a top-up is actually needed. Then ez-mode wraps the largest useful holding the wallet already has (TOKEN, USDC, or LEOS from the live directory).
- 402 pay path: `POST /v1/chat/completions` → 402 → optional wrap (`signAndSendTransaction`) → `POST /v1/pay/build` → wallet **signs** → retry with `X-PAYMENT`. The phone never broadcasts a 402 payment. It never calls `signAndSendTransaction` for the pay tx. It never builds the payment transaction with web3.js.

Solana rails are loaded from `https://x402.accrue.fund/supported` (cached ~5 minutes). Any `exact` kind on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` in that directory is accepted. Labels come from `extra.symbol` (wTOKENx2, yUSDCx, wLEOSx). The drained mint `Bo7xBF7SY8EyUBPUxRP66SFafxoPf2n5uqiLjbxEebx9` is never offered.

Wrap uses the wrap-nav program `FrSERTNCPvTtaDS9AvQp9u1nYGzXDb3kC9MdL8Xxn2NE` and the directory `acquire` block (nine accounts; the program pulls the deposit). Do not use the old five-account wrap.

## Wallet (iOS — not MWA)

`cordova-plugin-mwa` is Java / Android-only. It is left in the tree as unused upstream code and is **not** registered in `package.json`, so `cordova platform add ios` does not depend on it. The shell never calls `MWA.*`. `connectedMethod` is `phantom`, `solflare`, or `burner` — never `MWA`.

1. **Phantom (primary)** — [Phantom deeplinks](https://docs.phantom.com/phantom-deeplinks). Prefer `phantom://ul/v1/connect` and `phantom://ul/v1/signTransaction` when the app is installed (`canOpen phantom://`). `https://phantom.app/ul/v1/…` is the fallback. x25519 + TweetNaCl (`nacl.box.after` after `nacl.box.before`). Redirect `openzoo://phantom`. Phantom `errorCode` / `errorMessage` are shown as-is. If Phantom is not installed, the shell says so and does not claim a connection.
2. **Solflare** — same honest protocol, `solflare://ul/v1/…` when installed, https fallback, redirect `openzoo://solflare`.
3. **In-app burner** — Ed25519 key via TweetNaCl, stored in the iOS Keychain through `cordova-plugin-openzoo-wallet`. Label: *Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.*

Wrap (top-up) may use `signAndSendTransaction` so the wrap lands before the 402 is retried. The 402 pay transaction stays unsigned-fee-payer and is never broadcast from the phone.

The iframe talks to the shell over `postMessage`:

| direction | type | payload |
| --- | --- | --- |
| shell → app | `wallet-connected` | `{ address, method }` |
| shell → app | `wallet-disconnected` | — |
| app → shell | `wallet-request-info` | late init |
| app → shell | `wallet-disconnect` | back to the shell |
| app → shell | `wallet-sign-message` | `{ id, message }` → `wallet-sign-response` |
| app → shell | `wallet-sign-transaction` | `{ id, transaction }` (base64 unsigned) → `wallet-sign-transaction-response` |
| app → shell | `wallet-sign-and-send-transaction` | wrap only → `wallet-sign-and-send-transaction-response` |

`www/game/` is the unused CordovaSeeker clicker demo. `GAME_URL` points at `app/index.html`.

## Mac build (Xcode required)

This repository was assembled on a Linux cloud VM with no Xcode. **The iOS Simulator was not run. TestFlight was not started.** On a Mac:

```bash
npm install -g cordova
npm install
cordova platform add ios && cordova build ios
```

Equivalent npm scripts: `npm run platform:ios` then `npm run build:ios`, or `npm run ios`.

On this Linux VM, `cordova platform add ios` created `platforms/ios` (gitignored) and installed only `cordova-plugin-openzoo-wallet`. `cordova build ios` then failed: `xcodebuild was not found`. That compile step needs a Mac. The iOS Simulator was not run. TestFlight was not started.

## Tests (works on Linux)

```bash
npm test
bash scripts/smoke-gateway.sh
```

`npm test` parses the `/supported` fixture: FXY labels **wTOKENx2**, drained Bo7x is rejected, TOKEN `EVULo…` is the wrap source, and Phantom uses `phantom://` when installed.

Smoke curls live `GET /v1/stats` and `GET /v1/models`. Neither proves the iOS binary.

## Layout

```
www/index.html          wallet shell (iframe host)
www/app/                grokui-style chat / threads / attach
www/js/                 Phantom/Solflare + burner + live rails + wrap
test/                   node tests for the /supported directory
cordova-plugin-openzoo-wallet/   Keychain + canOpenURL + openURL (iOS)
cordova-plugin-mwa/     unused Android MWA plugin from CordovaSeeker
```

## License

MIT. CordovaSeeker portions remain under the upstream MIT license.
