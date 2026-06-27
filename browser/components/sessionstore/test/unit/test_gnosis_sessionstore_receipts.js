"use strict";

const { SessionWriter } = ChromeUtils.importESModule(
  "resource:///modules/sessionstore/SessionWriter.sys.mjs"
);
const { SessionStoreGnosis } = ChromeUtils.importESModule(
  "resource:///modules/sessionstore/SessionStoreGnosis.sys.mjs"
);

do_get_profile();
const {
  SessionFile: { Paths },
} = ChromeUtils.importESModule(
  "resource:///modules/sessionstore/SessionFile.sys.mjs"
);

function createSessionState(id) {
  return {
    windows: [
      {
        tabs: [
          {
            entries: [{ url: `https://example.com/gnosis-session-${id}` }],
            index: 1,
          },
        ],
      },
    ],
  };
}

async function prepareWriter() {
  SessionWriter.init("empty", false, Paths, {
    maxSerializeBack: -1,
    maxSerializeForward: -1,
    maxUpgradeBackups: 3,
  });
  await SessionWriter.wipe();
  SessionStoreGnosis.resetForTests();
}

async function readReceipts() {
  let path = SessionStoreGnosis.receiptPath(Paths);
  let text = await IOUtils.readUTF8(path);
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

add_setup(async function () {
  Services.prefs.setBoolPref("forkjoin.gnosis.storage.active.enabled", true);
  Services.prefs.setBoolPref("forkjoin.gnosis.auth.active.enabled", true);
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref("forkjoin.gnosis.storage.active.enabled");
    Services.prefs.clearUserPref("forkjoin.gnosis.auth.active.enabled");
    SessionStoreGnosis.resetForTests();
    await SessionWriter.wipe();
  });
});

add_task(async function test_sessionstore_gnosis_receipt_chain() {
  await prepareWriter();

  let first = await SessionWriter.write(createSessionState("first"));
  Assert.equal(
    first.telemetry.gnosis?.recorded,
    true,
    "first write records a Gnosis receipt"
  );

  let receipts = await readReceipts();
  Assert.equal(receipts.length, 1, "first write appended one receipt");
  Assert.equal(receipts[0].route, "knotchain-append", "receipt uses knotchain");
  Assert.equal(receipts[0].target, "recovery", "first receipt targets recovery");
  Assert.equal(receipts[0].tabCount, 1, "receipt records tab count");
  Assert.equal(receipts[0].profilePathRedacted, true, "profile path is redacted");

  let rawReceipt = await IOUtils.readUTF8(SessionStoreGnosis.receiptPath(Paths));
  Assert.ok(
    !rawReceipt.includes("example.com"),
    "receipt does not persist raw session URLs"
  );

  let second = await SessionWriter.write(createSessionState("second"), {
    isFinalWrite: true,
  });
  Assert.equal(
    second.telemetry.gnosis?.recorded,
    true,
    "final write records a Gnosis receipt"
  );

  receipts = await readReceipts();
  Assert.equal(receipts.length, 2, "second write appended a second receipt");
  Assert.equal(receipts[1].target, "clean", "final receipt targets clean");
  Assert.equal(
    receipts[1].previousBlockHash,
    receipts[0].blockHash,
    "second receipt links to the first block"
  );
});
