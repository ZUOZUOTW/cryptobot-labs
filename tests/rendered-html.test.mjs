import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
const templateRoot = new URL("../", import.meta.url);

async function render(host = "preview.example") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://preview.example/", {
      headers: { accept: "text/html", host },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the CryptoBot Labs production shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<html lang="zh-Hant">/i);
  assert.match(html, /<title>CryptoBot Labs｜WEEX 自動交易策略實驗室<\/title>/i);
  assert.match(html, /CryptoBot Labs/);
  assert.match(html, /機器人/);
  assert.match(html, /排行榜/);
  assert.match(html, /組裝車間/);
  assert.match(html, /模擬回測資料，不代表未來績效/);
  assert.match(html, /<meta property="og:image" content="https:\/\/preview\.example\/og\.png"\/>/i);
  assert.match(html, /<meta property="og:image:width" content="1672"\/>/i);
  assert.match(html, /<meta property="og:image:height" content="941"\/>/i);
  assert.match(html, /<meta property="og:image:alt" content="CryptoBot Labs：把交易想法，組裝成你的機器人。WEEX API · 推薦"\/>/i);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/preview\.example\/og\.png"\/>/i);
  assert.match(html, /<meta name="twitter:image:width" content="1672"\/>/i);
  assert.match(html, /<meta name="twitter:image:height" content="941"\/>/i);
  assert.match(html, /<meta name="twitter:image:alt" content="CryptoBot Labs：把交易想法，組裝成你的機器人。WEEX API · 推薦"\/>/i);
});

test("omits social images for an ambiguous Host header", async () => {
  const response = await render("preview.example, attacker.example");
  const html = await response.text();

  assert.doesNotMatch(html, /(?:property|name)="(?:og|twitter):image"/i);
});

test("removes the starter preview and retains the production shell contract", async () => {
  const [css, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(css, /--bg:\s*#06070b/);
  assert.match(css, /@keyframes\s+orbit/);
  assert.match(css, /@keyframes\s+scan/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.match(layout, /title:\s*SITE_TITLE/);
  assert.match(layout, /<html lang="zh-Hant">/);
  assert.match(layout, /<SiteHeader \/>/);
  assert.match(layout, /<SiteFooter \/>/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|themeColor|\bViewport\b/);

  await assert.rejects(access(new URL("public/_sites-preview", templateRoot)));
});
