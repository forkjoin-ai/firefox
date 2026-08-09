/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

add_task(async function test_public_aeon_host_keeps_web_secure_context() {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:blank");
  const browser = tab.linkedBrowser;
  const loaded = BrowserTestUtils.browserLoaded(
    browser,
    false,
    url => url == "https://example.com/"
  );

  browser.loadURI(Services.io.newURI("aeon://example.com/"), {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  await loaded;

  const capability = await SpecialPowers.spawn(browser, [], () => ({
    protocol: content.location.protocol,
    secure: content.isSecureContext,
    randomUUID: typeof content.crypto.randomUUID,
  }));
  Assert.deepEqual(capability, {
    protocol: "https:",
    secure: true,
    randomUUID: "function",
  });

  BrowserTestUtils.removeTab(tab);
});
