// dsh-tailscale-console — 设备配对（浏览器会话签发）核心逻辑
//
// 解决的问题：dsh web 的浏览器登录依赖「启动令牌」，它只在进程启动时打印一次，
// 且每次重启都会更换——所有设备必须翻终端找 URL 重新登录，摩擦极大。
//
// 原理：dsh 的会话 cookie 签名密钥是**持久化 credential**
//（client-connection/browser-session，重启不换），cookie 受众 = 请求 Host。
// 本模块按 @deepseek-ai/dsh-client-connection 的同一算法签发会话 cookie，
// 效果与官方「令牌换 cookie」流程完全等价。
//
// 安全模型：
// - 配对码生成：仅回环（Mac 本机面板）——授权动作始终由本机用户做出
// - 配对码兑换：tailnet 信任域内可达；单次使用；10 分钟过期；大小写/横线归一化
// - 签发的 cookie 与官方令牌流程逐字节同构（同一密钥/受众/30 天有效期）

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const SECRET_BYTES = 32
const STORED_SECRET_VERSION = 1
const COOKIE_PREFIX = "dsh-auth-"
const COOKIE_PAYLOAD_VERSION = 1
const DAY_MILLISECONDS = 86_400_000
// 配对码字符集：去掉 0/1/I/L/O 等易混字符
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return undefined
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64")
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

/** dsh 同款 cookie 名：dsh-auth-<base64url(sha256(authority))>，authority = 请求 Host。 */
export function cookieNameFor(authority) {
  return COOKIE_PREFIX + encodeBase64Url(createHash("sha256").update(authority).digest())
}

/**
 * 按官方算法签发一个浏览器会话 cookie。
 * @param authority 请求 Host（如 "mac-mini.xxx.ts.net" 或 "127.0.0.1:3080"），作为签名受众
 * @param secretBase64Url 凭据记录中的 base64url 签名密钥（32 字节）
 * @param nowMs 签发时间（毫秒）
 * @param maxAgeDays 有效期天数，默认 30（与 dsh cookieMaxAgeDays 默认一致）
 */
export function mintSessionCookie(authority, secretBase64Url, nowMs, maxAgeDays = 30) {
  const secret = decodeBase64Url(secretBase64Url)
  if (secret === undefined || secret.byteLength !== SECRET_BYTES) throw new Error("pairing: browser-session secret is not a 32-byte base64url value")
  const issuedAt = nowMs
  const expiresAt = issuedAt + maxAgeDays * DAY_MILLISECONDS
  const body = encodeBase64Url(Buffer.from(JSON.stringify({
    version: COOKIE_PAYLOAD_VERSION,
    authority,
    issuedAt,
    expiresAt,
  }), "utf8"))
  const signature = createHmac("sha256", secret).update(body).digest()
  const value = `v1.${body}.${encodeBase64Url(signature)}`
  const name = cookieNameFor(authority)
  const maxAgeSeconds = Math.floor((expiresAt - issuedAt) / 1000)
  const setCookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
  return { name, value, setCookie, expiresAt }
}

/** 生成易读配对码：XXXX-XXXX，字符集去除易混字符。 */
export function pairingCode() {
  const bytes = randomBytes(8)
  let code = ""
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * 内存配对码存储：单次使用 + TTL。
 * redeem 对大小写与横线归一化（用户手输场景）。
 */
export function createPairingStore(ttlMs) {
  const issued = new Map()
  return {
    issue(nowMs) {
      const code = pairingCode()
      const expiresAt = nowMs + ttlMs
      issued.set(code, expiresAt)
      return { code, expiresAt }
    },
    redeem(code, nowMs) {
      const normalized = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      for (const [known, expiresAt] of issued) {
        if (known.replace("-", "") !== normalized) continue
        issued.delete(known) // 单次使用：无论成败先消费
        if (nowMs > expiresAt) return { ok: false, reason: "expired" }
        return { ok: true }
      }
      return { ok: false, reason: "unknown" }
    },
  }
}

/**
 * 从 dsh 的 browser-session 凭据记录中取出签名密钥。
 * 记录形态与 @deepseek-ai/dsh-client-connection 的 storedSecret 校验一致：
 * { kind: "grant", payload: { version: 1, secret: <base64url 32 字节> } }。
 */
export function secretFromRecord(record) {
  if (record === undefined || typeof record !== "object") throw new Error("pairing: browser-session credential record is missing")
  if (record.kind !== "grant" || typeof record.payload !== "object" || record.payload === null || record.payload.version !== STORED_SECRET_VERSION) throw new Error("pairing: browser-session credential record has an unsupported format")
  const secret = decodeBase64Url(String(record.payload.secret ?? ""))
  if (secret === undefined || secret.byteLength !== SECRET_BYTES) throw new Error("pairing: browser-session credential record has an invalid secret")
  return secret
}

/** 便捷函数：直接从凭据记录签发会话 cookie（内部完成密钥提取与编码）。 */
export function mintSessionCookieFromRecord(authority, record, nowMs, maxAgeDays = 30) {
  return mintSessionCookie(authority, encodeBase64Url(secretFromRecord(record)), nowMs, maxAgeDays)
}
