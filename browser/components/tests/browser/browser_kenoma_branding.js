/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

add_task(async function test_kenoma_branding_does_not_open_firefox_pages() {
  const defaults = Services.prefs.getDefaultBranch("");

  for (const pref of [
    "startup.homepage_override_url",
    "startup.homepage_welcome_url",
    "startup.homepage_welcome_url.additional",
  ]) {
    const target = defaults.getStringPref(pref);
    Assert.ok(
      !/mozilla\.org|firefox\.com/i.test(target),
      `${pref} does not open a Firefox-branded remote page: ${target}`
    );
  }
});

add_task(async function test_kenoma_desktop_feature_names() {
  const branding = new Localization(
    ["branding/brand.ftl", "toolkit/branding/brandings.ftl"],
    true
  );

  Assert.deepEqual(
    await branding.formatValues([
      "-brand-short-name",
      "-firefox-home-brand-name",
      "-firefoxview-brand-name",
      "-firefoxlabs-brand-name",
    ]),
    ["Kenoma", "Kenoma Home", "Kenoma View", "Kenoma Labs"]
  );
});
