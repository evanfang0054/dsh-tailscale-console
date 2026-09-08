// 配对页单测
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderPairPage, renderPairSuccess } from "../lib/pairing-page.js"

test("配对页: 含输入表单、指引与深浅色", () => {
  const html = renderPairPage({})
  assert.match(html, /<form method="get" action="\/tsctl\/pair">/)
  assert.match(html, /name="c"/)
  assert.match(html, /maxlength="9"/)
  assert.match(html, /prefers-color-scheme/)
  assert.match(html, /添加到主屏幕/)
  assert.match(html, /iOS[\s\S]*Android/s)
})

test("配对页: 错误态含红字提示且转义", () => {
  const html = renderPairPage({ error: '配对码无效或已过期<script>' })
  assert.match(html, /pair-error/)
  assert.match(html, /配对码无效或已过期/)
  assert.ok(!html.includes("<script>"), "错误文案必须 HTML 转义")
})

test("配对成功页: 含安装按钮/manifest/主题色/控制台入口", () => {
  const html = renderPairSuccess({})
  assert.match(html, /id="install-btn"/)
  assert.match(html, /rel="manifest" href="\/tsctl\/manifest\.webmanifest"/)
  assert.match(html, /apple-touch-icon/)
  assert.match(html, /serviceWorker\.register\('\/tsctl\/sw\.js'/)
  assert.match(html, /beforeinstallprompt/)
  assert.match(html, /进入控制台/)
  assert.match(html, /standalone/)
})
test("配对成功页: 不含外部依赖与内联样式表外的资源", () => {
  const html = renderPairSuccess({})
  assert.ok(!html.includes("http://"), "不应含 http 外链")
  assert.ok(!html.includes("https://"), "不应含 https 外链（self 引用用相对路径）")
})

test("配对成功页: standalone 已装 APP 打开时自动跳进控制台（顺带静默续期 cookie）", () => {
  const html = renderPairSuccess({})
  assert.match(html, /location\.replace\('\/'\)/)
  assert.match(html, /display-mode: standalone/)
})
