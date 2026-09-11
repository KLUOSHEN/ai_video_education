import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const errors = [];
const warnings = [];

function parseEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]),
  );
}

function setting(name, envFile) {
  return process.env[name] || envFile[name] || "";
}

for (const file of ["server.js", "package.json", "search.html", "watch.html", ".env.example"]) {
  if (!existsSync(join(repoRoot, file))) errors.push(`缺少必要文件：${file}`);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 20) errors.push(`Node.js 版本过低：${process.versions.node}（要求 >= 20）`);

if (!existsSync(join(repoRoot, "out", "index.html"))) {
  warnings.push("尚未生成 out/index.html；部署前运行 npm run build");
}

const envPath = join(repoRoot, ".env");
const envFile = parseEnv(envPath);
if (!existsSync(envPath) && !process.env.API_KEY && !process.env.DATA_ENCRYPTION_KEY && !process.env.CORS_ORIGIN) {
  warnings.push("未找到 .env；本地部署请从 .env.example 复制，托管平台可直接注入环境变量");
}

const productionChecks = [
  ["API_KEY", (value) => value.length >= 16, "应设置长度至少 16 的访问密钥"],
  ["DATA_ENCRYPTION_KEY", (value) => value.length >= 32 && !value.includes("change-this"), "应设置至少 32 字节的随机密钥"],
  ["CORS_ORIGIN", (value) => /^https:\/\//.test(value) && value !== "*", "应设置正式 HTTPS 前端来源"],
];

for (const [name, valid, message] of productionChecks) {
  if (!valid(setting(name, envFile))) warnings.push(`${name}：${message}`);
}
if (!setting("QWEN_API_KEY", envFile) && !setting("ARK_API_KEY", envFile)) {
  warnings.push("未配置 QWEN_API_KEY 或 ARK_API_KEY，真实 AI 生成会回退或失败");
}
if (!setting("APP_DATA_DIR", envFile) || !setting("APP_STORAGE_DIR", envFile)) {
  warnings.push("未同时配置 APP_DATA_DIR / APP_STORAGE_DIR；云平台上请指向持久卷");
}
for (const name of ["DOUBAO_TTS_API_KEY", "TTS_PROVIDER"]) {
  if (setting(name, envFile)) warnings.push(`${name} 当前未被 server.js 使用，可从 .env 移除`);
}

if (strict && warnings.length) errors.push(...warnings.splice(0));

console.log(`Node.js ${process.versions.node}：通过`);
for (const warning of warnings) console.warn(`警告：${warning}`);
for (const error of errors) console.error(`错误：${error}`);

if (errors.length) {
  console.error(`部署检查失败（${errors.length} 项）`);
  process.exitCode = 1;
} else {
  console.log("部署检查通过");
}
