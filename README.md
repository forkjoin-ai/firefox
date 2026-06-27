![Kenoma Browser](./docs/readme/readme-banner.svg)

# Kenoma

This checkout is the Kenoma browser fork mounted at `open-source/firefox`.
For local build, run, verification, commercial-surface policy, `aeon://`
handling, and Aeon bridge notes, see [LOCAL_AGENTS.md](./LOCAL_AGENTS.md).

The current Forkjoin build path uses Mozilla `mach` through a0 targets:

```bash
pnpm run a0 -- run @a0n/firefox:build:tmp
pnpm run a0 -- run @a0n/firefox:run:monorepo:new-profile
pnpm run a0 -- run @a0n/firefox:brand:generate
pnpm run a0 -- run @a0n/firefox:native-install
```

The `/tmp` build target exists because local macOS permissions can block a full
Firefox build from `~/Documents`. Successful `build:tmp` runs now mirror the
packaged app into the ignored monorepo path
`open-source/firefox/build/forkjoin/Kenoma.app`.

Aeon browser support is split across the built-in `aeon://` protocol handler,
the bundled `browser/extensions/aeon` extension, and the
`native/forkjoin-aeon-bridge.mjs` native host. The native host handles Flow
frames, UDP transport, wall requests/benchmarks, pneuma frames, residual
payloads, voice envelopes, and Lacey PRNG state.

[Firefox](https://firefox.com/) is a fast, reliable and private web browser from the non-profit [Mozilla organization](https://mozilla.org/).

### Contributing

To learn how to contribute to Firefox read the [Firefox Contributors' Quick Reference document](https://firefox-source-docs.mozilla.org/contributing/contribution_quickref.html).

We use [bugzilla.mozilla.org](https://bugzilla.mozilla.org/) as our issue tracker, please file bugs there.

### Resources

* [Firefox Source Docs](https://firefox-source-docs.mozilla.org/) is our primary documentation repository
* Nightly development builds can be downloaded from [Firefox Nightly page](https://www.mozilla.org/firefox/channel/desktop/#nightly)

If you have a question about developing Firefox, and can't find the solution
on [Firefox Source Docs](https://firefox-source-docs.mozilla.org/), you can try asking your question on Matrix at
chat.mozilla.org in the [Introduction channel](https://chat.mozilla.org/#/room/#introduction:mozilla.org).
