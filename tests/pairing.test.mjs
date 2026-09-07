// dsh-tailscale-console — 设备配对单测
//
// 背景：dsh web 的浏览器登录 = 「启动令牌（仅启动时打印）→ 换取持久签名 cookie」。
// 每次重启令牌更换、所有设备登录态失效，用户必须翻终端——摩擦极大。
//
// 本插件的「设备配对」在工具层解决：Mac 本机面板生成一次性配对码（10 分钟），
// 远程设备打开 /tsctl/pair?c=<码> 即获得与官方令牌流程**完全同构**的会话 cookie
// （同一持久签名密钥、同一 authority 受众、同一 30 天有效期）。
//
// 测试策略：mint 侧为 lib/pairing.js 的实现；decode 侧在本文件独立复刻 dsh
// 的 decodeCookie 逻辑（与 @deepseek-ai/dsh-client-connection 逐行对齐），
// 以「独立解码成功」证明互操作性——实现与校验互为镜像，防止单边自洽。

import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"

import { pairingCode, createPairingStore, mintSessionCookie, secretFromRecord } from "../lib/pairing.js"

// ── 独立复刻 dsh 的 decodeCookie（@deepseek-ai/dsh-client-connection）─────────
function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}
function b64urlDecode(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64")
  return b64urlEncode(decoded) === value ? decoded : undefined
}
function cookieNameOf(authority) {
  return "dsh-auth-" + b64urlEncode(createHash("sha256").update(authority).digest())
}
// 与 dsh 的 decodeCookie 逐行对齐
function decodeCookieLikeDsh(value, secretBytes) {
  const parts = value.split(".")
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== "v1" || body === undefined || encodedSignature === undefined) return undefined
  const actualSignature = b64urlDecode(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = createHmac("sha256", secretBytes).update(body).digest()
  if (actualSignature.byteLength !== expectedSignature.byteLength || !actualSignature.equals(expectedSignature)) return undefined
  let decoded
  try {
    const bodyBytes = b64urlDecode(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString("utf8"))
  } catch {
    return undefined
  }
  if (typeof decoded !== "object" || decoded === null || decoded.version !== 1 || typeof decoded.authority !== "string" || !Number.isSafeInteger(decoded.issuedAt) || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  return decoded
}

const AUTHORITY = "mac-mini.example.ts.net"
// 32 字节密钥（与 dsh 的 SECRET_BYTES 一致），base64url 编码形态（credential 里存的形态）
const SECRET_B64 = b64urlEncode(Buffer.alloc(32, 7))

test("mintSessionCookie: cookie 名 = dsh-auth-<base64url(sha256(authority))>", () => {
  const minted = mintSessionCookie(AUTHORITY, SECRET_B64, 1_000_000, 30)
  assert.equal(minted.name, cookieNameOf(AUTHORITY))
})

test("mintSessionCookie: 独立按 dsh 逻辑解码成功且 payload 正确（互操作核心用例）", () => {
  const issuedAt = 1_725_000_000_000
  const minted = mintSessionCookie(AUTHORITY, SECRET_B64, issuedAt, 30)
  const decoded = decodeCookieLikeDsh(minted.value, b64urlDecode(SECRET_B64))
  assert.notEqual(decoded, undefined, "dsh 的 decodeCookie 必须能解码我们签发的 cookie")
  assert.equal(decoded.version, 1)
  assert.equal(decoded.authority, AUTHORITY)
  assert.equal(decoded.issuedAt, issuedAt)
  assert.equal(decoded.expiresAt, issuedAt + 30 * 86_400_000)
})

test("mintSessionCookie: Set-Cookie 属性与 dsh 官方一致（Max-Age/Path/Expires/HttpOnly/SameSite=Strict）", () => {
  const minted = mintSessionCookie(AUTHORITY, SECRET_B64, 1_000_000, 30)
  assert.match(minted.setCookie, /^dsh-auth-[^=]+=[^;]+; Max-Age=2592000; Path=/)
  assert.match(minted.setCookie, /; Expires=/)
  assert.match(minted.setCookie, /; HttpOnly; SameSite=Strict$/)
})

test("mintSessionCookie: 密钥不同则签名校验失败（secret 真实参与签名）", () => {
  const minted = mintSessionCookie(AUTHORITY, SECRET_B64, 1_000_000, 30)
  const wrongSecret = b64urlEncode(Buffer.alloc(32, 9))
  assert.equal(decodeCookieLikeDsh(minted.value, b64urlDecode(wrongSecret)), undefined)
})

test("mintSessionCookie: 默认 30 天；自定义天数生效", () => {
  const now = 1_725_000_000_000
  assert.equal(mintSessionCookie(AUTHORITY, SECRET_B64, now).expiresAt - now, 30 * 86_400_000)
  assert.equal(mintSessionCookie(AUTHORITY, SECRET_B64, now, 7).expiresAt - now, 7 * 86_400_000)
})

test("pairingCode: 形如 XXXX-XXXX，无易混字符（0/1/I/O），批量生成不重复", () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const code = pairingCode()
    assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/)
    seen.add(code)
  }
  assert.equal(seen.size, 200)
})

test("配对存储: 有效期内单次兑换成功，重复兑换失败", () => {
  const store = createPairingStore(10 * 60 * 1000)
  const { code } = store.issue(1000)
  assert.equal(store.redeem(code, 2000).ok, true)
  assert.equal(store.redeem(code, 3000).ok, false, "同一码第二次兑换必须失败（单次使用）")
})

test("配对存储: 超过 TTL 兑换失败；未知码失败；大小写与分隔符归一化", () => {
  const store = createPairingStore(10 * 60 * 1000)
  const expired = store.issue(1000)
  assert.equal(store.redeem(expired.code, 1000 + 10 * 60 * 1000 + 1).ok, false)
  assert.equal(store.redeem("NOPE-NOPE", 2000).ok, false)
  const { code } = store.issue(1000)
  assert.equal(store.redeem(code.toLowerCase().replace("-", ""), 2000).ok, true, "用户手输小写/无横线也应成功")
})

test("secretFromRecord: 从 client-connection/browser-session 凭据记录取出 32 字节密钥", () => {
  const record = { kind: "grant", payload: { version: 1, secret: SECRET_B64 } }
  const secret = secretFromRecord(record)
  assert.equal(b64urlEncode(secret), SECRET_B64)
  assert.equal(secret.byteLength, 32)
})

test("secretFromRecord: 格式不符时抛错（与 dsh 的 storedSecret 行为一致）", () => {
  assert.throws(() => secretFromRecord({ kind: "other", payload: {} }))
  assert.throws(() => secretFromRecord({ kind: "grant", payload: { version: 2, secret: SECRET_B64 } }))
  assert.throws(() => secretFromRecord(undefined))
})
