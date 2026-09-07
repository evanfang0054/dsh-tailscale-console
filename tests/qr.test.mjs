// QR 编码器单测：以「真实解码器能否扫出」为验收标准（jsQR 解码回读）。
// 注：不同规范实现可合法选择不同掩码（解码器不感知掩码），故不做跨库矩阵全等比较。
import { test } from "node:test"
import assert from "node:assert/strict"
import jsQR from "jsqr"
import { qrMatrix, qrSvg } from "../lib/qr.js"

// 把模块矩阵转成 jsQR 可读的 RGBA 位图（4 模块静区，4px/模块——jsQR 对 1px 模块采样不可靠）
function toBitmap(text) {
  const { size, get } = qrMatrix(text)
  const scale = 4
  const quiet = 4 * scale
  const w = size * scale + quiet * 2
  const data = new Uint8ClampedArray(w * w * 4)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const mx = Math.floor((x - quiet) / scale)
      const my = Math.floor((y - quiet) / scale)
      const dark = mx >= 0 && mx < size && my >= 0 && my < size && get(my, mx) === 1
      const o = (y * w + x) * 4
      data[o] = data[o + 1] = data[o + 2] = dark ? 0 : 255
      data[o + 3] = 255
    }
  return { data, w }
}

function decode(text) {
  const { data, w } = toBitmap(text)
  const res = jsQR(data, w, w, { inversionAttempts: "dontInvert" })
  return res === null ? null : res.data
}

test("解码回读: 常规配对链接原样解出", () => {
  const s = "https://mac-mini.example.ts.net/tsctl/pair?c=AB2C-9DEF"
  assert.equal(decode(s), s)
})

test("解码回读: 短输入 / 长输入 / UTF-8 中文", () => {
  assert.equal(decode("A"), "A")
  const long = "https://very-long-host-name-for-testing.tailnet-example.ts.net/tsctl/pair?c=ZZZZ-9999&extra=1"
  assert.equal(decode(long), long)
  const cn = "https://mac-mini.example.ts.net/tsctl/pair?c=测试12码"
  assert.equal(decode(cn), cn)
})

test("qrSvg: 输出 svg 且含静区与模块路径", () => {
  const svg = qrSvg("https://mac-mini.example.ts.net/tsctl/pair?c=AB2C-9DEF")
  assert.match(svg, /^<svg /)
  assert.match(svg, /viewBox="-8 -8 \d+ \d+"/)
  assert.match(svg, /<path d="/)
})
