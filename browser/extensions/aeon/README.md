# Aeon Bridge

This built-in Firefox add-on is the browser-side bridge for Aeon Flow frames,
`wall`-compatible Aeon requests, Bitwise codecs, UDP transport, and the Lacey
seeded PRNG path.

## What it owns

- Marshaling `aeon.frame.encode` / `aeon.frame.decode` requests.
- Exposing `aeon.frame.reassemble` and `aeon.frame.streams` for the
  out-of-order UDP frame path and the canonical pneuma stream IDs
  (`0x07d0` through `0x07d4`).
- Relaying `aeon.wall.request` / `aeon.wall.bench` through the same native host
  contract used by the `open-source/aeon/packages/wall` command.
- Relaying `aeon.udp.send` / `aeon.udp.receive` through a native host, because
  extension JS cannot bind UDP sockets directly.
- Forwarding `bitwise.pneuma.encode` / `bitwise.pneuma.decode`,
  `bitwise.pneuma.residual.*`, and `bitwise.pneuma.voice-flac.*` requests.
- Forwarding `gnosis.lacey.seed` / `gnosis.lacey.next` deterministic state
  requests.

## What it does not own

- The canonical frame schema lives in Aeon.
- The canonical codec implementations live in Bitwise.
- The canonical Lacey PRNG semantics live in Gnosis.
- Transport-heavy work lives in a native host named `forkjoin-aeon-bridge`.

The browser script only handles message routing and binary-safe serialization.
Binary fields are wrapped in a base64 envelope when they cross the native-messaging boundary.

Callers can use `browser.runtime.sendMessage(...)` for one-shot operations or
`browser.runtime.connect({ name: "aeon-bridge" })` for long-lived flows such as
UDP receive loops and wall benchmark runs. The native host receives:

```json
{
  "id": 1,
  "type": "aeon.frame.encode",
  "payload": {
    "streamId": 2000,
    "sequence": 1,
    "flags": 16,
    "payload": {
      "__aeonBinaryBase64": "AAECAw==",
      "__aeonBinaryView": "Uint8Array"
    }
  }
}
```

The supported operation names intentionally mirror the package boundaries:

- Aeon Flow: `FlowCodec`, `FrameReassembler`, `UDPFlowTransport`, and `wall`.
- Bitwise: pneuma residual and voice-FLAC codecs.
- Gnosis: Lacey deterministic state operations.
