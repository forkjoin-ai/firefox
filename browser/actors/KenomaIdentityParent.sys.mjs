/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Privileged side of the Kenoma shared-identity (SSO) bridge.
//
// The badge is stashed in global Firefox prefs so it is shared across every
// about: content origin (about:id, about:kenoma, about:todo, ...). Prefs are
// global, so they are immune to storage partitioning and give true single
// sign-on across the otherwise-isolated about: pages.

const PREF_TOKEN = "kenoma.identity.badgeToken";
const PREF_DID = "kenoma.identity.did";
const PREF_JSON = "kenoma.identity.json";

// Notified whenever any of the identity prefs change, in any process, so all
// open about: pages re-render in sync.
const PREF_BRANCH = "kenoma.identity.";

export class KenomaIdentityParent extends JSWindowActorParent {
  actorCreated() {
    this._observer = () => {
      try {
        this.sendAsyncMessage("KenomaIdentity:Changed", this.readBadge());
      } catch (e) {
        // The actor may be tearing down; ignore.
      }
    };
    Services.prefs.addObserver(PREF_BRANCH, this._observer);
  }

  didDestroy() {
    if (this._observer) {
      Services.prefs.removeObserver(PREF_BRANCH, this._observer);
      this._observer = null;
    }
  }

  readBadge() {
    const token = Services.prefs.getStringPref(PREF_TOKEN, "");
    if (!token) {
      return null;
    }
    const did = Services.prefs.getStringPref(PREF_DID, "");
    let profile = null;
    const raw = Services.prefs.getStringPref(PREF_JSON, "");
    if (raw) {
      try {
        profile = JSON.parse(raw);
      } catch (e) {
        profile = null;
      }
    }
    return { token, did, profile };
  }

  writeBadge(badge) {
    if (!badge || typeof badge !== "object" || typeof badge.token !== "string") {
      return false;
    }
    Services.prefs.setStringPref(PREF_TOKEN, badge.token);
    Services.prefs.setStringPref(
      PREF_DID,
      typeof badge.did === "string" ? badge.did : ""
    );
    Services.prefs.setStringPref(
      PREF_JSON,
      badge.profile == null ? "" : JSON.stringify(badge.profile)
    );
    return true;
  }

  clearBadge() {
    Services.prefs.clearUserPref(PREF_TOKEN);
    Services.prefs.clearUserPref(PREF_DID);
    Services.prefs.clearUserPref(PREF_JSON);
  }

  async receiveMessage(message) {
    switch (message.name) {
      case "KenomaIdentity:Get":
        return this.readBadge();
      case "KenomaIdentity:Set":
        return this.writeBadge(message.data);
      case "KenomaIdentity:Clear":
        this.clearBadge();
        return true;
    }
    return null;
  }
}
