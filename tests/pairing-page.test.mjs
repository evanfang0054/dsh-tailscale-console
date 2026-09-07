// 配对页单测
import { test } from "node:test"
import assert from "node:assert/strict"
import { renderPairPage } from "../lib/pairing-page.js"

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
