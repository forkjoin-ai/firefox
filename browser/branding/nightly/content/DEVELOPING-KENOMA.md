# Developing Kenoma (`about:kenoma` + friends)

Kenoma is the Forkjoin Firefox fork. Its sovereign surfaces are **`about:` pages**
(`about:kenoma` operator page, `about:id` identity, `about:weather`, `about:todo`, …)
that run as **no-bundler vanilla thin clients** against production Forkjoin APIs, with
privileged capabilities injected by **JSWindowActor** pairs.

This doc is the map + the hard-won gotchas. Read it before touching `about:kenoma`.

---

## 1. The pieces

| File | Role |
|---|---|
| `browser/branding/nightly/content/kenoma-home.{html,js,css}` | The `about:kenoma` operator page (vanilla, no bundler, served from `chrome://branding/content/`). |
| `browser/actors/KenomaAgentParent.sys.mjs` | **Privileged** (parent process, system principal): network fetches, the moonshine agent loop, prefs. |
| `browser/actors/KenomaAgentChild.sys.mjs` | Injects frozen `window.KenomaAgent` into the page; relays to the parent via `sendQuery`. |
| `browser/actors/KenomaIdentityParent/Child.sys.mjs` | Shared SSO bridge → `window.KenomaIdentity`; card.yoga OAuth + badge, stored in global prefs (SSO across all about: pages). |
| `browser/components/about/AboutRedirector.cpp` + `components.conf` | Registers the `about:` URLs. |
| `<fork>/build/` | **Upstream Firefox source** (mach bootstrap). NOT regenerable — see Gotchas. |

The content page is **unprivileged**. Anything needing a system principal (cross-origin
fetch without CORS, opening privileged schemes, reading prefs, spawning a subprocess,
`Services.appinfo`) must go through the actor. The actor exposes a frozen API on
`window.KenomaAgent`; the page calls it and `await`s.

---

## 2. The injected APIs

`window.KenomaAgent` (from `KenomaAgentChild`) — each is a promise unless noted:
- `run(task, forks)` / `stop()` / `onEvent(cb)` — the moonshine **browser agent** loop (perceive→decide→act). `onEvent` streams `{kind: start|observe|fork|decide|act|offload|stopped|done|error}`.
- `ask(task)` → `{answered, answer}` — **offload**: moonshine instant oracle, no LLM/agent (see §5).
- `status()` → `{weather,memory,todos,facts}` each `{ok,label,count}` — the four sovereign data pills.
- `version()` → `{appVersion, appBuildID}` (the footer build id).
- `wallet()` / `topup(cents)` — custodial EDGEWORK wallet (user-only).
- `location()` / `setLocation({lat,lon,label})` / `detectLocation()` / `weather({lat,lon})` / `geoSearch(q)` — the shared current-location store + weather.
- `recent()` / `setRecent(items)` — operator history (persisted in a pref; see Gotchas).
- `open(url)` — navigate via the **system principal** (for `aeon://` etc. that content can't link to).

`window.KenomaIdentity` (from `KenomaIdentityChild`):
- `getBadge()` → `{token,did,profile}|null` · `signIn()` (card.yoga Google OAuth popup → fractal-iam badge) · `signOut()` · `onChange(cb)`. Events: `KenomaIdentity:ready`, `KenomaIdentity:change`.

Both inject on `DOMDocElementInserted`; the page wires immediately if present, else on the
`KenomaAgent:ready` / `KenomaIdentity:ready` window event.

### Prefs (the cross-page state)
- `kenoma.identity.badgeToken` / `.did` / `.json` — the SSO badge (KenomaIdentityParent writes; KenomaAgentParent reads it as the `Authorization: Bearer` for UCAN-gated apps).
- `kenoma.location.json` — canonical current location for all products.
- `kenoma.recent.json` — operator history.
- `forkjoin.gnosis.moonshine.binary` — override for the moonshine binary path.

---

## 3. Build & run

Front-end / actor changes only (JS/HTML/CSS/.sys.mjs):
```
cd open-source/firefox
./mach build faster      # ~8s incremental; do NOT use `./mach build` for FE-only
./mach run               # or launch obj-*/dist/Kenoma.app
```
Actors are JSWindowActors registered in `DesktopActorRegistry.sys.mjs` for
`matches: ["about:kenoma", …]`. **Fully restart the browser** to pick up actor/page
changes — a running instance keeps the old chrome files.

### Marionette verification (headless, scriptable)
The binary is `obj-aarch64-apple-darwin25.5.0/dist/Kenoma.app/Contents/MacOS/firefox`
(NOT `dist/bin/firefox`). Launch with `-marionette -headless --new-instance -profile <tmp> about:kenoma`,
then drive port `2828` with a raw length-prefixed-JSON client. A reusable client lives in the
session scratchpad (`marionette_check.py` / `marionette_ui.py`). Pattern: `WebDriver:NewSession`
→ `WebDriver:Navigate {url:"about:kenoma"}` → `WebDriver:ExecuteAsyncScript` calling
`window.KenomaAgent.*` and reading the DOM. This is how every feature in this page was verified.

---

## 4. Backend dependencies (all reached **via the actor**, never direct content fetch)

| Pill / feature | Endpoint | Auth |
|---|---|---|
| Weather (pill + nav display) | `storms.watch/api/live/current-storms`, `/api/weather/forecast?lat&lon`, `/api/geo/search?q`, `/api/geo/here` | public (CORS open for chrome) |
| Memory | `memory-api.forkjoin.ai` — `POST /auth/ucan/global` (guest grant) → `GET /api/spaces/global/api/memory/pool` | UCAN (guest-or-user) |
| Todos | `todo.forkjoin.ai` — `POST /auth/ucan/global` → `GET /api/sync/pull/{spaceId}` (suffix!) | UCAN |
| Facts | `fact.forkjoin.ai/api/spaces/global/api/sync/pull` | public reads |
| Identity | `card.yoga` (fractal-iam) — `/auth/browser/start`, `/auth/browser/status`, `/iam/badge/issue` | OAuth → badge |
| Wallet | `www-edgework-app.edgework.ai/api/edgework/{wallet,topup}` | badge bearer |
| Agent / offload | local `moonshine` subprocess | none (no paid AI) |

**Path shapes differ per app**: memory/fact use `/api/spaces/{id}/api/...`; todo uses
`/api/sync/pull/{id}` (spaceId as a *suffix*). A 404 body parsed as `(j.operations||[]).length`
silently reads as `0` — always check the HTTP status, not just the count.

### UCAN: guest-or-user
memory/todo verify a UCAN signed by the **service's own secret-derived key**, so clients
**cannot self-mint** one. Each app exposes `POST /auth/ucan/global` (guest grant; no auth →
`did:ucan:guest:<uuid>`, or upgraded if a valid bearer is sent). The actor mints + caches one
per app (keyed by the current badge) and sends it as the bearer. fact reads are public.

---

## 5. The offload oracle (Run / Agent, "easy calculator")

Run/Enter and the Agent button are **offload-first**: before a web search or the agent loop,
the actor runs `moonshine -c "<query>"` with `MOONSHINE_ORACLE_ONLY=1` (added in
`gnosis/moonshine/src/main.rs`). That mode runs only the instant tiers (`calc::try_answer`,
arithmetic, and `oracles::try_oracle` → logic/prob/**solver**/date/string) and **exits 2** if
nothing answers — never touching the LLM. The numeric solver
(`oracles::try_solve_numeric`) bisects `f(x)=lhs−rhs`, so `r^3=16`, `2^x=8`, `x^2-5x+6=0`,
`3x+7=22` all resolve instantly with no `solve` prefix. The agent binary is resolved from
`forkjoin.gnosis.moonshine.binary` pref then `gnosis/moonshine/target/release/moonshine`.
Rebuild with `cargo build --release --bin moonshine`.

---

## 6. Adding a data source / pill
1. Add an actor method in `KenomaAgentParent` that fetches (privileged) and returns a small
   normalized object; add its `KenomaAgent:*` case in `receiveMessage`.
2. Expose it in `KenomaAgentChild.injectAPI()` (`Cu.exportFunction`) + a wrapper method.
3. In `kenoma-home.js`, call it from a `refresh*()` and paint the DOM; wire it in the bottom
   init block **and** in `kenomaOnAgentReady()` (the actor may inject after the deferred script).
4. Host allowlist lives in `STATUS_BASE` in the parent.

---

## 7. Gotchas (read these)

- **`about:` pages have no usable `localStorage`** — it throws `NS_ERROR_NOT_AVAILABLE`. An
  unguarded read aborts the whole init block. Use an in-memory source of truth + the **actor
  pref** for persistence (that's why recent/location/fork live in prefs). Wrap any localStorage
  in try/catch.
- **Content can't link to privileged schemes** (`aeon://`, …): clicking an `<a href="aeon://…">`
  throws a Security Error. Route through `KenomaAgent.open(url)` (system principal). A delegated
  handler in `kenoma-home.js` (`wireSchemeLinks`) does this for all `a[href^="aeon:"]`.
- **`.is-hidden` was only `.widget-band.is-hidden`** historically — there is now a generic
  `.is-hidden{display:none!important}`. Don't assume a class hides unless a rule exists.
- **`a0 flow` once deleted Firefox's source `build/`** — its artifact-cleanup treated `build/`
  as regenerable and its tracked-file guard (`a0/src/artifacts.ts`) ran `git ls-files` from the
  monorepo root, which can't see into the firefox **submodule** → reported 0 tracked → deleted.
  Fixed (the guard now runs git from inside the dir). If mach ever says *"No mach source
  directory found"*, restore: `git checkout <flow-commit>^ -- build/`.
- **Deploy quirks** (when touching the backends):
  - **fractal-iam deploys BARE** (`a0 xr deploy`, no `--env production`) — the top-level worker
    owns the `card.yoga` routes; `--env production` deploys a separate worker and hits CF 10020.
  - **storms-watch** has a first-match-by-order tsconfig-paths trap: put `@a0n/<pkg>/*` wildcards
    (and specials like `@a0n/raect/client`) **above** the bare `@a0n/<pkg>` entries or the client
    build can't resolve deep imports.
  - Recurring **dep-dist wipes** block deploys (`@a0n/dash/src/sync`, `aeon-clockwork/dist`, …):
    `pnpm --filter <pkg> run build` then retry.
  - **D1 migrations**: `pnpm exec wrangler d1 execute <db> --remote --file <migration>.sql`. The
    badge tables (`iam_badges`, `iam_badge_audit`) are migration `0008` in `apps/fractal-iam/migrations/`.
- **No paid AI**: the only inference path is the local `moonshine` binary. Never add `env.AI`,
  Workers AI, or external LLM keys to worker code.

---

## 8. Sibling skill
`kenoma-about-app` scaffolds a new `about:<app>` thin client (one app → one page) following the
`AboutRedirector.cpp` + `components.conf` + `branding/jar.mn` + `chrome://branding/content/<app>-home.*`
pattern. Use it for new surfaces; this doc is for evolving `about:kenoma` itself.
