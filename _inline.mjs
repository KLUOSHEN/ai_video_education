import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ROOT = "out";
const OUT = "landing.html";

function read(p) { const f = `${ROOT}/${p}`; return existsSync(f) ? readFileSync(f) : null; }
function b64(p) { const b = read(p); return b ? b.toString("base64") : null; }
function mime(f) { const e = f.split(".").pop().toLowerCase(); return ({ svg: "image/svg+xml", png: "image/png", css: "text/css", js: "text/javascript" })[e] || "application/octet-stream"; }

let html = readFileSync(`${ROOT}/index.html`, "utf8");

// 移除 preload 提示（单文件里无意义）
html = html.replace(/<link rel="preload"[^>]*>/g, "");

// 1) 内联 CSS
html = html.replace(/<link rel="stylesheet" href="\/_next\/static\/chunks\/([^"]+\.css)"[^>]*\/>/g, (m, f) => {
  const b = read(`_next/static/chunks/${f}`);
  return b ? `<style>${b.toString("utf8")}</style>` : m;
});

// 2) 内联 JS（去掉 async/crossorigin，保持原顺序）
html = html.replace(/<script src="\/_next\/static\/chunks\/([^"]+\.js)"([^>]*)><\/script>/g, (m, f, attrs) => {
  const b = read(`_next/static/chunks/${f}`);
  if (!b) return m;
  const clean = attrs.replace(/\sasync=""/g, "").replace(/\scrossorigin=""/g, "");
  // 转义 JS 里可能出现的 </script>，避免提前闭合标签破坏 HTML
  const code = b.toString("utf8").replace(/<\/script/gi, "<\\/script");
  return `<script${clean}>${code}</script>`;
});

// 3) 内联图片（HTML img / CSS url / JS 字符串里的 /originkit/hero-35/*）
const assets = ["corner-glow.svg", "logo-mark.svg", "menu.svg", "planet.svg", "star-glow.svg", "rocket-rotated.png"];
for (const a of assets) {
  const b = b64(`originkit/hero-35/${a}`);
  if (!b) continue;
  const uri = `data:${mime(a)};base64,${b}`;
  const re = new RegExp("/originkit/hero-35/" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  html = html.split(re).join(uri);
}

writeFileSync(OUT, html, "utf8");
console.log("written", OUT, html.length, "bytes");
