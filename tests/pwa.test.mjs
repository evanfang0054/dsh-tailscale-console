// PWA 资源增强单测
import { test } from "node:test"
import assert from "node:assert/strict"
import { enhancedManifest, injectPwaHead, injectInstallBootstrap } from "../lib/pwa.js"

const ORIG = '<!doctype html><html><head><meta charset="utf-8"/><link rel="manifest" href="./manifest.webmanifest"/><link rel="icon" href="./favicon.svg"/></head><body></body></html>'

test("enhancedManifest: 继承 dsh 字段且 standalone + PNG icons", () => {
  const m = enhancedManifest()
  assert.equal(m.name, "DeepSeek Harness")
  assert.equal(m.short_name, "DSH")
  assert.equal(m.start_url, "/tsctl/auto-login")
  assert.equal(m.scope, "/")
  assert.equal(m.display, "standalone")
  assert.equal(m.theme_color, "#1f2430")
  assert.equal(m.background_color, "#0f172a")
  const png = m.icons.filter((i) => i.type === "image/png")
  assert.deepEqual(png.map((i) => i.sizes), ["192x192", "512x512"])
  assert.ok(png.every((i) => i.purpose === "any maskable" && i.src.startsWith("/tsctl/icons/")))
  assert.ok(m.icons.some((i) => i.type === "image/svg+xml"), "保留原 SVG 项")
})

test("injectPwaHead: 替换 manifest 链接并注入 apple-touch-icon", () => {
  const out = injectPwaHead(ORIG)
  assert.match(out, /rel="manifest" href="\/tsctl\/manifest\.webmanifest"/)
  assert.match(out, /rel="apple-touch-icon" sizes="180x180" href="\/tsctl\/icons\/180\.png"/)
  assert.ok(!out.includes("./manifest.webmanifest"), "原相对链接已替换")
})

test("injectPwaHead: 找不到 manifest link 时原样返回（兜底）", () => {
  const html = "<html><head></head></html>"
  assert.equal(injectPwaHead(html), html)
})

test("injectInstallBootstrap: 注入 SW 注册与安装捕获脚本", () => {
  const out = injectInstallBootstrap(ORIG)
  assert.match(out, /serviceWorker\.register\('\/tsctl\/sw\.js', \{ scope: '\/' \}\)/)
  assert.match(out, /beforeinstallprompt/)
  assert.match(out, /__dshPwaInstall/)
  assert.match(out, /<\/head>/, "注入点在 head 内")
})
test("injectInstallBootstrap: 重复注入不叠加（幂等）", () => {
  const once = injectInstallBootstrap(ORIG)
  assert.equal(injectInstallBootstrap(once), once)
})

test("enhancedManifest: start_url 指向自动登录路由（APP 打开即续登）", () => {
  assert.equal(enhancedManifest().start_url, "/tsctl/auto-login")
})
