import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exportRoot = join(repoRoot, "out");
const outputFile = join(repoRoot, "landing.html");

function read(relativePath) {
  const file = join(exportRoot, relativePath);
  return existsSync(file) ? readFileSync(file) : null;
}

function toBase64(relativePath) {
  const buffer = read(relativePath);
  return buffer ? buffer.toString("base64") : null;
}

function mime(file) {
  return ({ ".svg": "image/svg+xml", ".png": "image/png", ".css": "text/css", ".js": "text/javascript" })[extname(file).toLowerCase()] || "application/octet-stream";
}

let html = readFileSync(join(exportRoot, "index.html"), "utf8");
html = html.replace(/<link rel="preload"[^>]*>/g, "");
html = html.replace(/<link rel="stylesheet" href="\/_next\/static\/chunks\/([^"]+\.css)"[^>]*\/>/g, (original, file) => {
  const buffer = read(`_next/static/chunks/${file}`);
  return buffer ? `<style>${buffer.toString("utf8")}</style>` : original;
});
html = html.replace(/<script src="\/_next\/static\/chunks\/([^"]+\.js)"([^>]*)><\/script>/g, (original, file, attributes) => {
  const buffer = read(`_next/static/chunks/${file}`);
  if (!buffer) return original;
  const cleanAttributes = attributes.replace(/\sasync=""/g, "").replace(/\scrossorigin=""/g, "");
  const code = buffer.toString("utf8").replace(/<\/script/gi, "<\\/script");
  return `<script${cleanAttributes}>${code}</script>`;
});

const assets = ["corner-glow.svg", "logo-mark.svg", "menu.svg", "planet.svg", "star-glow.svg", "rocket-rotated.png"];
for (const asset of assets) {
  const data = toBase64(`originkit/hero-35/${asset}`);
  if (!data) continue;
  const uri = `data:${mime(asset)};base64,${data}`;
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  html = html.replace(new RegExp(`/originkit/hero-35/${escaped}`, "g"), uri);
}

writeFileSync(outputFile, html, "utf8");
console.log("written", outputFile, html.length, "bytes");
