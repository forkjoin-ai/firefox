# Aeon Bridge

This built-in Firefox add-on is the browser-side bridge for Aeon Flow frames,
Bitwise codecs, and the Lacey seeded PRNG path.

## What it owns

- Marshaling `aeon.frame.encode` / `aeon.frame.decode` requests.
- Relaying `aeon.udp.send` / `aeon.udp.receive` through a native host, because
  extension JS cannot bind UDP sockets directly.
- Forwarding `bitwise.pneuma.encode` / `bitwise.pneuma.decode` requests.
- Forwarding `gnosis.lacey.seed` / `gnosis.lacey.next` deterministic state
  requests.

## What it does not own

- The canonical frame schema lives in Aeon.
- The canonical codec implementations live in Bitwise.
- The canonical Lacey PRNG semantics live in Gnosis.
- Transport-heavy work lives in a native host named `forkjoin-aeon-bridge`.

The browser script only handles message routing and binary-safe serialization.
Binary fields are wrapped in a base64 envelope when they cross the native-messaging boundary.
