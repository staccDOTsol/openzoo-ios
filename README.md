# OpenZoo iOS

OpenZoo on iOS is a **CordovaSeeker** app. The wallet lives in `www/index.html`. The product UI is a bundled iframe at `www/app/` (chat, bind, stats). There is no SwiftUI app and no Capacitor project.

This tree started from [FreeSolDev/CordovaSeeker](https://github.com/FreeSolDev/CordovaSeeker) (MIT). Work stays on `staccDOTsol/openzoo-ios`. Do not push this product back to CordovaSeeker.

## What this is

- Widget id `fun.openzoo.ios`, name **OpenZoo**
- Custom URL scheme `openzoo` — Phantom redirect `openzoo://phantom`
- Chat / bind / stats only against `https://x402-tokens.fly.dev`
- Default chat model: `openai/gpt-4o-mini` (live on `GET /v1/models` when this repo was written)
- Payment: `POST /v1/chat/completions` → 402 → user picks a Solana rail → `POST /v1/pay/build` → wallet **signs** → retry with `X-PAYMENT`. The phone never broadcasts. It never calls `signAndSendTransaction`. It never builds the payment transaction with web3.js.

Solana rails only (NAV-wrapped Token-2022 twins, not plain USDC):

| symbol | mint | decimals |
| --- | --- | --- |
| yUSDCx | `6ZjjxcoicqM4nniddkuPVwew4PDwY3swbfHsGbCuLuTv` | 6 |
| wTOKENx | `FXYkwMtfKpA174rp8ixVeiGs5TYGaBsYRrHE3KrR449B` | 6 |
| wLEOSx | `3FViQRMqtG6dUDFxZyyVvpM9xTHsKdX7uqZ5jvL8NZ35` | 9 |

Network `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. `payTo` / `feePayer`: `WzMaL78srutrF6CsxEkWuhMaDF5HZA6jNRaEPengqpb`.

These settle in wrapped twins, not plain USDC. If the wallet doesn’t hold the twin, simulation fails.

## Wallet (iOS — not MWA)

`cordova-plugin-mwa` is Java / Android-only. It is left in the tree as unused upstream code and is **not** registered in `package.json`, so `cordova platform add ios` does not depend on it. The shell never calls `MWA.*`. `connectedMethod` is `phantom`, `solflare`, or `burner` — never `MWA`.

1. **Phantom (primary)** — [Phantom deeplinks](https://docs.phantom.com/phantom-deeplinks): `https://phantom.app/ul/v1/connect` and `https://phantom.app/ul/v1/signTransaction`. x25519 + TweetNaCl (`nacl.box.after`). Redirect `openzoo://phantom`. If Phantom is not installed, the shell says so and does not claim a connection.
2. **Solflare** — same honest protocol: `https://solflare.com/ul/v1/connect` and `/signTransaction`, redirect `openzoo://solflare`. If Solflare is not installed, the shell says so.
3. **In-app burner** — Ed25519 key via TweetNaCl, stored in the iOS Keychain through `cordova-plugin-openzoo-wallet`. Label: *Local disposable key on this phone. We never custody it. We do not sell crypto. You fund it yourself.*

The iframe talks to the shell over `postMessage`:

| direction | type | payload |
| --- | --- | --- |
| shell → app | `wallet-connected` | `{ address, method }` |
| shell → app | `wallet-disconnected` | — |
| app → shell | `wallet-request-info` | late init |
| app → shell | `wallet-disconnect` | back to the shell |
| app → shell | `wallet-sign-message` | `{ id, message }` → `wallet-sign-response` |
| app → shell | `wallet-sign-transaction` | `{ id, transaction }` (base64 unsigned) → `wallet-sign-transaction-response` |

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

## Gateway smoke (works on Linux)

```bash
bash scripts/smoke-gateway.sh
```

Curls live `GET /v1/stats` and `GET /v1/models`. Does not prove the iOS binary.

## Layout

```
www/index.html          wallet shell (iframe host)
www/app/                Chat / Bind / Stats
www/js/                 Phantom/Solflare + burner helpers
cordova-plugin-openzoo-wallet/   Keychain + canOpenURL + openURL (iOS)
cordova-plugin-mwa/     unused Android MWA plugin from CordovaSeeker
```

## License

MIT. CordovaSeeker portions remain under the upstream MIT license.
