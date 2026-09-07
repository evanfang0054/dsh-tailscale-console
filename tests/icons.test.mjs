// 图标资源单测：PNG 签名 + IHDR 尺寸
import { test } from "node:test"
import assert from "node:assert/strict"
import { iconPng, ICON_SIZES } from "../lib/icons.js"

test("iconPng: 返回 PNG 签名与正确 IHDR 尺寸", () => {
  for (const s of ICON_SIZES) {
    const png = iconPng(s)
    assert.ok(png, `缺少 ${s} 尺寸`)
    assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    assert.equal(png.readUInt32BE(16), s, "IHDR 宽")
    assert.equal(png.readUInt32BE(20), s, "IHDR 高")
  }
})

test("iconPng: 未知尺寸返回 undefined", () => {
  assert.equal(iconPng(64), undefined)
})
