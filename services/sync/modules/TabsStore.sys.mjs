/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  TabsStore:
    "moz-src:///toolkit/components/uniffi-bindgen-gecko-js/components/generated/RustTabs.sys.mjs",
});

var storePromise = null;

/**
 * Handles the firefox get Tabs Store workflow.
 */
export async function getTabsStore() {
  if (storePromise == null) {
    const path = PathUtils.join(PathUtils.profileDir, "synced-tabs.db");
    storePromise = lazy.TabsStore.init(path);

    lazy.AsyncShutdown.profileBeforeChange.addBlocker(
      "TabsStore: shutdown",
      async function blocker() {
        try {
          let store = await storePromise;
          await store.closeConnection();
          storePromise = null;
        } finally {
          lazy.AsyncShutdown.profileBeforeChange.removeBlocker(blocker);
        }
      }
    );
  }
  return await storePromise;
}

/**
 * Handles the firefox get Remote Command Store workflow.
 */
export async function getRemoteCommandStore() {
  const store = await getTabsStore();
  // creating a new remote command store is cheap (but not free, so maybe we should cache this in the future?)
  return await store.newRemoteCommandStore();
}

export {
  RemoteCommand,
  PendingCommand,
} from "moz-src:///toolkit/components/uniffi-bindgen-gecko-js/components/generated/RustTabs.sys.mjs";
