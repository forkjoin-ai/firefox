# Kenoma Local Agents

This tree is the Kenoma browser fork mounted under `open-source/firefox`. Use
it for browser integration work around Aeon frames, Bitwise codecs, Gnosis Lacey
streams, sovereign search, commercial-surface removal, and Forkjoin-owned
branding.

## Build Commands

Run workspace targets from the monorepo root:

```bash
pnpm run a0 -- run @a0n/firefox:sync:tmp
pnpm run a0 -- run @a0n/firefox:brand:generate
pnpm run a0 -- run @a0n/firefox:build:tmp
pnpm run a0 -- run @a0n/firefox:verify:tmp
pnpm run a0 -- run @a0n/firefox:mirror:tmp
pnpm run a0 -- run @a0n/firefox:version:tmp
pnpm run a0 -- run @a0n/firefox:run:tmp:new-profile
pnpm run a0 -- run @a0n/firefox:run:monorepo:new-profile
pnpm run a0 -- run @a0n/firefox:native-self-test
pnpm run a0 -- run @a0n/firefox:native-probe
pnpm run a0 -- run @a0n/firefox:native-install
pnpm run a0 -- run @a0n/firefox:runtime-bench
pnpm run a0 -- run @a0n/firefox:scheduler-bench
pnpm run a0 -- run @a0n/firefox:storage-bench
pnpm run a0 -- run @a0n/firefox:commandbar-smoke
```

The in-tree `mach build` target exists as `@a0n/firefox:build`, but local macOS
TCC/provenance restrictions can deny reads inside `~/Documents`. The `build:tmp`
target copies Forkjoin files into `/tmp/forkjoin-firefox-build` and builds there.

Built app:

```text
/tmp/forkjoin-firefox-build/obj-aarch64-apple-darwin25.5.0/dist/Kenoma.app
```

Monorepo mirror, refreshed by `build:tmp` and `mirror:tmp`:

```text
open-source/firefox/build/forkjoin/Kenoma.app
```

Executable:

```text
/tmp/forkjoin-firefox-build/obj-aarch64-apple-darwin25.5.0/dist/Kenoma.app/Contents/MacOS/firefox
open-source/firefox/build/forkjoin/Kenoma.app/Contents/MacOS/firefox
```

## Kenoma Branding

Kenoma uses `open-source/aeon-ux/sigil-rs/out/keystone.svg` for the app icon
and `open-source/aeon-ux/src/swag/svg/piece-knot-void.svg` for the home splash.
Regenerate derived branding assets with:

```bash
pnpm run a0 -- run @a0n/firefox:brand:generate
```

`build:tmp` runs the same generator inside `/tmp/forkjoin-firefox-build` before
calling `mach build`, so the mirrored app stays reproducible.

## Commercial Surface Policy

`browser/app/profile/firefox.js` ends with Forkjoin first-run overrides. Keep
these as last-wins defaults for:

- no sponsored top sites, Contile, Pocket, Discovery Stream, Mozilla ads, or news
- no Mozilla weather widgets or Merino weather endpoints
- no Normandy studies, Activity Stream private pings, telemetry pings, or content relevancy ingestion
- no Mozilla partner attribution endpoints

`browser/app/distribution/policies.json` is packaged by
`browser/app/distribution/moz.build` and enforces:

- Wiki as default search: `https://wiki.forkjoin.ai/search?q={searchTerms}`
- no default Mozilla bookmarks
- Forkjoin-owned bookmarks for Wiki, Storms Watch, SkyChat, SkyMesh, Edgework,
  Dashrelay, and Forkjoin
- Firefox Home without Weather, Pocket, Stories, sponsored stories, or snippets
- Firefox Suggest without sponsored/online suggestions
- Mozilla AI helper features blocked by default

## Aeon URL Handling

Firefox now registers an internal `aeon://` protocol handler:

- `aeon://wiki.forkjoin.ai` keeps the top-level browser URL as `aeon://...`
  and renders the HTTPS public origin inside a local Aeon fallback frame
- loopback hosts use HTTP for local development, e.g. `aeon://127.0.0.1:8787/foo`
  redirects to `http://127.0.0.1:8787/.aeon/foo`
- public host-style addresses use the same non-redirect fallback frame while
  public origins grow native `X-Aeon-*` endpoint negotiation
- `aeon://rhizome/...` redirects to the edge Rhizome resolver at
  `https://api.edgework.ai/v1/rhizome/resolve?address=...`
- other resource-style Aeon addresses are sent to Wiki search until a local
  native resolver is wired

This prevents urlbar fallback to Google/search for Aeon addresses.

## Sovereign App Routing

Current replacement sources:

- Search and wiki: `apps/paplimpset`, product name `Wiki`, canonical host `https://wiki.forkjoin.ai`
- Weather: `apps/storms-watch`, canonical public surface `https://storms.watch`
- News / live broadcast: `apps/skymesh-rtmp` and `apps/skychat`
- Default app bookmarks: `apps/edgework-app`, `apps/dashrelay-app`, `apps/edge-web-app`

The user-facing name is `palimpset` in conversation, but the current repo path
is `apps/paplimpset`. Do not introduce another spelling in code without a repo
rename or redirect decision.

## Aeon / Bitwise / Lacey Boundary

The bundled extension in `browser/extensions/aeon` exposes a browser contract
for:

- Aeon frame encode/decode/reassembly/streams
- Aeon wall request and bench calls
- Aeon UDP send/receive calls
- Bitwise pneuma and residual codec calls
- Bitwise voice-FLAC codec calls
- Gnosis Lacey seed/next calls
- Gnosis runtime capability discovery, FRF run/bench, FOIL run/telemetry,
  runtime cache stats/clear, Moonshine command execution, amplituhedron cache lookup/prefetch,
  antiqueue scheduling telemetry, gnosis-antiqueue helix scheduler observe/plan/bench,
  bitwise/knotchain/knotgraph storage observe/plan/bench, aeon-3d render status/bench,
  Aether WASM-SIMD status/bench, x-gnosis status/bench, and gnosis-uring status/bench

It routes those calls to the native messaging host named
`forkjoin-aeon-bridge`.

The native host lives in `native/forkjoin-aeon-bridge.mjs` and is installed by:

```bash
pnpm run a0 -- run @a0n/firefox:native-install
```

On macOS the installer writes:

```text
~/Library/Application Support/Mozilla/NativeMessagingHosts/forkjoin-aeon-bridge.json
```

Native bridge capabilities:

- Aeon Flow frame encode/decode via `open-source/aeon/src/flow/FlowCodec.js`
- Aeon frame reassembly via `open-source/aeon/src/flow/frame-reassembler.js`
- direct UDP datagram send/receive for browser transport channels
- `wall` subprocess delegation for full Aeon request and benchmark modes, including `--udp`, `--raw-path`, and race/bench flags
- embedded bwDense + Pleromatic pneuma frame encode/decode for the browser hot path
- residual channel encode/decode for byte deltas or Int16 residual payloads
- browser-safe voice-FLAC envelope encode/decode until the TypeScript voice-FLAC module is emitted as native JS
- Gnosis Lacey nested PRNG seed/next state for procedural browser streams
- a runtime capability registry for `open-source/gnosis`, `open-source/aeon-3d`,
  `open-source/aether`, `open-source/x-gnosis`, and `gnosis-uring`
- in-process caching for file status probes, capability discovery,
  amplituhedron JSON parsing, and Aether WASM compilation, visible through
  `gnosis.runtime.cache.stats` and cleared with `gnosis.runtime.cache.clear`
- Moonshine command execution through `gnosis.moonshine.exec`
- local benchmark harnesses for FRF, aeon-3d rendering math, Aether WASM-SIMD,
  and uring packet accounting
- gnosis-antiqueue helix scheduler harnesses that compare stock Firefox event
  ordering with an active safe lane for low-risk priorities only
- storage-routing harnesses that compare temp-disk writes with bitwise binary
  envelopes and knotgraph block packing, without touching profile data

Use `native-self-test` for direct handler verification and `native-probe` for
Firefox native-message framing verification without launching the browser.
Use `runtime-bench` for the lightweight runtime benchmark receipt and
`scheduler-bench` / `storage-bench` for focused scheduler and storage receipts.
Use `commandbar-smoke` to verify the bundled Moonshine command-bar popup is packaged.

Top-level `aeon://` navigation uses the stable resolver path by default. The
experimental wall-backed page channel is gated behind
`aeon.protocol.wall.experimental.enabled` and must stay disabled until a chrome
protocol-handler harness proves it cannot crash content tabs.

Gnosis runtime prefs live in `browser/app/profile/firefox.js`:

- `forkjoin.gnosis.runtime.enabled` defaults on for bridge capability discovery.
- `forkjoin.gnosis.commandbar.enabled` defaults on for the bundled Moonshine popup.
- `forkjoin.gnosis.scheduler.observe.enabled` and
  `forkjoin.gnosis.storage.observe.enabled` default on for bridge benchmarks.
- `forkjoin.gnosis.scheduler.enabled`, `forkjoin.gnosis.scheduler.active.enabled`,
  `forkjoin.gnosis.storage.active.enabled`, and `forkjoin.gnosis.network.enabled`
  default off until Gecko-internal scheduler/network harnesses prove semantic
  parity and responsiveness wins.
