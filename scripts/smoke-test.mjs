import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const runtimeDir = mkdtempSync(join(tmpdir(), "ai-learning-studio-smoke-"));
process.env.APP_DATA_DIR = join(runtimeDir, "data");
process.env.APP_STORAGE_DIR = join(runtimeDir, "storage");

const require = createRequire(import.meta.url);
const { server, store } = require("../server.js");

try {
  await store.init();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const origin = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200, "首页必须返回 200；请先运行 npm run build");
  const html = await home.text();
  assert.match(html, /栈知映/);

  const assetUrls = new Set(
    [...html.matchAll(/(?:src|href)="(\/(?:_next|originkit)\/[^"?#]+)["?#]/g)].map((match) => match[1]),
  );
  assert.ok(assetUrls.size > 0, "首页应引用本地构建资源");
  for (const assetUrl of assetUrls) {
    const response = await fetch(`${origin}${assetUrl}`);
    assert.equal(response.status, 200, `${assetUrl} 必须可访问`);
    if (assetUrl.startsWith("/_next/static/")) {
      assert.match(response.headers.get("cache-control") || "", /immutable/);
    }
  }

  const health = await fetch(`${origin}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  for (const pathname of ["/.env.example", "/server.js", "/data/rag-index.json", "/skilltree-app/server.js"]) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 404, `${pathname} 不应被公开访问`);
  }

  console.log(`冒烟检查通过：首页、${assetUrls.size} 个本地资源、健康接口与敏感路径隔离均正常`);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  rmSync(runtimeDir, { recursive: true, force: true });
}
