#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const sourceRoot = resolve(new URL("..", import.meta.url).pathname);
const defaultRepoRoot = resolve(sourceRoot, "..", "..");
const targetRoot = readArg("--target-root") || sourceRoot;
const repoRoot = readArg("--repo-root") || defaultRepoRoot;
const rsvgConvert = process.env.RSVG_CONVERT || "/opt/homebrew/bin/rsvg-convert";
const iconutil = process.env.ICONUTIL || "/usr/bin/iconutil";

const brandingRoot = join(targetRoot, "browser", "branding", "nightly");
const brandingContentRoot = join(brandingRoot, "content");
const sigilSource = join(repoRoot, "open-source", "aeon-ux", "sigil-rs", "out", "keystone.svg");
const splashSource = join(repoRoot, "open-source", "aeon-ux", "src", "swag", "svg", "piece-knot-void.svg");

function readArg(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return "";
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return resolve(value);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing Kenoma branding source: ${path}`);
  }
}

function svgInner(svg) {
  const match = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/);
  if (!match) {
    throw new Error("Could not extract SVG body");
  }
  return match[1];
}

function themedSigilSvg() {
  const inner = svgInner(readFileSync(sigilSource, "utf8"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="kenoma-core" cx="48%" cy="38%" r="68%">
      <stop offset="0%" stop-color="#f9df7b"/>
      <stop offset="44%" stop-color="#d99b47"/>
      <stop offset="100%" stop-color="#2b170f"/>
    </radialGradient>
    <linearGradient id="kenoma-void" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#15191c"/>
      <stop offset="100%" stop-color="#030506"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" rx="138" fill="url(#kenoma-void)"/>
  <circle cx="300" cy="300" r="236" fill="url(#kenoma-core)" opacity="0.18"/>
  <circle cx="300" cy="300" r="224" fill="none" stroke="#f6d66d" stroke-width="8" opacity="0.62"/>
  <g transform="translate(66 66) scale(.78)" color="#f6d66d" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
  <circle cx="300" cy="300" r="74" fill="#050607" stroke="#f6d66d" stroke-width="5" opacity="0.92"/>
</svg>
`;
}

function themedSplashSvg() {
  const inner = svgInner(readFileSync(splashSource, "utf8"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="kenoma-splash-field" cx="50%" cy="44%" r="58%">
      <stop offset="0%" stop-color="#f6d66d" stop-opacity=".24"/>
      <stop offset="58%" stop-color="#d56d39" stop-opacity=".13"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#kenoma-splash-field)"/>
  <g color="#f6d66d" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" opacity=".86">
    ${inner}
  </g>
</svg>
`;
}

function renderPng(svgPath, pngPath, size) {
  mkdirSync(dirname(pngPath), { recursive: true });
  run(rsvgConvert, ["-w", String(size), "-h", String(size), "-o", pngPath, svgPath]);
}

function generateIconset(svgPath) {
  const iconsetPath = join(brandingRoot, "kenoma.iconset");
  rmSync(iconsetPath, { recursive: true, force: true });
  mkdirSync(iconsetPath, { recursive: true });
  const entries = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of entries) {
    renderPng(svgPath, join(iconsetPath, name), size);
  }
  run(iconutil, ["-c", "icns", iconsetPath, "-o", join(brandingRoot, "firefox.icns")]);
  rmSync(iconsetPath, { recursive: true, force: true });
}

requireFile(sigilSource);
requireFile(splashSource);
mkdirSync(brandingContentRoot, { recursive: true });

const sigilPath = join(brandingContentRoot, "kenoma-sigil.svg");
const splashPath = join(brandingContentRoot, "kenoma-splash.svg");
writeFileSync(sigilPath, themedSigilSvg());
writeFileSync(splashPath, themedSplashSvg());

for (const size of [16, 22, 24, 32, 48, 64, 128, 256]) {
  renderPng(sigilPath, join(brandingRoot, `default${size}.png`), size);
}
renderPng(sigilPath, join(brandingContentRoot, "about-logo.png"), 192);
renderPng(sigilPath, join(brandingContentRoot, "about-logo@2x.png"), 384);
renderPng(sigilPath, join(brandingContentRoot, "about.png"), 300);
writeFileSync(join(brandingContentRoot, "about-logo.svg"), themedSigilSvg());
writeFileSync(
  join(brandingContentRoot, "about-wordmark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 560 120"><text x="0" y="88" fill="#f7efe0" font-family="Georgia, serif" font-size="96" letter-spacing="-8">Kenoma</text></svg>\n`
);
writeFileSync(
  join(brandingContentRoot, "firefox-wordmark.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 560 120"><text x="0" y="88" fill="#f7efe0" font-family="Georgia, serif" font-size="96" letter-spacing="-8">Kenoma</text></svg>\n`
);
generateIconset(sigilPath);

console.log(`Generated Kenoma branding into ${brandingRoot}`);
