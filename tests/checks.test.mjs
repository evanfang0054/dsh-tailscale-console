// dsh-tailscale-console — 健康检查判定逻辑单测
//
// 背景（issue #1）：「/sidebar/api」在 dsh 本体上不存在（未装 better-sidebar 时
// POST 405 / GET 404），装了旧版 better-sidebar 又因信任 bug 远程 403，属于失效
// 检查项。修复 = 以「远程 /api RPC（经 HTTPS 入口）」探测取代之。
//
// 运行：npm test （node --test）

import { test } from "node:test"
import assert from "node:assert/strict"

import { pageCheck, apiProbeCheck, remoteApiCheck } from "../lib/checks.js"

test("pageCheck: 200 通过", () => {
  const r = pageCheck("200")
  assert.equal(r.ok, true)
})

test("pageCheck: 401 = 入口可达、登录围栏正常（issue 衍生场景，应通过且说明原因）", () => {
  const r = pageCheck("401")
  assert.equal(r.ok, true)
  assert.match(r.detail, /可达/)
})

test("pageCheck: 5xx / 空 / 其他码 不通过", () => {
  assert.equal(pageCheck("500").ok, false)
  assert.equal(pageCheck("502").ok, false)
  assert.equal(pageCheck("").ok, false)
  assert.equal(pageCheck("000").ok, false)
})

test("apiProbeCheck: 401 + unauthorized → 可达（要求凭据属预期）", () => {
  const r = apiProbeCheck(401, "unauthorized")
  assert.equal(r.ok, true)
  assert.match(r.detail, /凭据|围栏/)
})

test("apiProbeCheck: 200 + 合法会话 JSON → 通过并报告会话数", () => {
  const raw = JSON.stringify({ result: { ok: true, value: { items: [{}, {}, {}] } } })
  const r = apiProbeCheck(200, raw)
  assert.equal(r.ok, true)
  assert.match(r.detail, /3/)
})

test("apiProbeCheck: 200 + 非 JSON 垃圾 → 不通过", () => {
  assert.equal(apiProbeCheck(200, "<html>bad</html>").ok, false)
})

test("apiProbeCheck: 5xx → 不通过", () => {
  assert.equal(apiProbeCheck(500, "").ok, false)
})

test("remoteApiCheck: 200 = 远程 RPC 网关完整可用", () => {
  const r = remoteApiCheck("200")
  assert.equal(r.ok, true)
})

test("remoteApiCheck: 401/403 = 入口可达但被围栏拦下（应通过并说明）", () => {
  const a = remoteApiCheck("401")
  assert.equal(a.ok, true)
  assert.match(a.detail, /可达/)
  const b = remoteApiCheck("403")
  assert.equal(b.ok, true)
  assert.match(b.detail, /信任|trusted-host/)
})

// 回归测试（issue #1 的核心）：404/405 表示 /api 端点不存在，必须判失败——
// 旧版检查对 /sidebar/api 的 405 恒失败却无法给出可行动结论；新探测必须把
// 「端点缺失」与「围栏拦截」区分开。
test("remoteApiCheck: 404/405 = 端点不存在，必须失败并提示（issue #1 回归）", () => {
  const a = remoteApiCheck("405")
  assert.equal(a.ok, false)
  assert.match(a.detail, /端点/)
  const b = remoteApiCheck("404")
  assert.equal(b.ok, false)
  assert.match(b.detail, /端点/)
})

test("remoteApiCheck: 空/异常码 不通过", () => {
  assert.equal(remoteApiCheck("").ok, false)
  assert.equal(remoteApiCheck("000").ok, false)
})
