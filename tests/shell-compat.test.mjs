// dsh-tailscale-console — shell 服务调用适配单测（DSH 0.1.7 契约）
//
// 背景：DSH 0.1.7 移除 shell.run(spec)，新契约为 resolve() → execute(spec) →
// handle.result()（形状 {exitCode, timedOut, stdout:{text,truncated}, stderr:{…}}）。
// 本文件用 fake executor 锚定 execViaShell 的映射行为，保证 /tsctl/api 各路由
// 拿到的返回形状与 0.1.5 时代一致。
//
// 运行：npm test （node --test）

import { test } from "node:test"
import assert from "node:assert/strict"

import { execViaShell } from "../lib/shell-run.js"

// 实现 0.1.7 契约的 fake executor：记录 resolve 收到的请求；execute 返回带 result() 的句柄。
function fakeShell(result, { reject = false } = {}) {
  const resolved = []
  return {
    resolved,
    resolve: (request) => { resolved.push(request); return { ...request, onExpiry: "kill" } },
    execute: async () => ({
      result: async () => {
        if (reject) throw new Error("subprocess failed before reporting an outcome")
        return result
      },
    }),
  }
}

test("成功路径：exitCode/stdout/stderr 按旧形状映射，且无 truncated 键", async () => {
  const shell = fakeShell({
    exitCode: 0, timedOut: false,
    stdout: { text: "out-text" }, stderr: { text: "err-text" },
  })
  const r = await execViaShell({ shell, policy: undefined, command: "tailscale status --json", timeoutMs: 5000 })
  assert.deepEqual(r, { exitCode: 0, timedOut: false, stdout: "out-text", stderr: "err-text" })
})

test("resolve 收到命令与超时；policy 透传为 sandboxPolicy", async () => {
  const shell = fakeShell({ exitCode: 0, timedOut: false, stdout: { text: "" }, stderr: { text: "" } })
  const policy = { mode: "danger-full-access" }
  await execViaShell({ shell, policy, command: "echo hi", timeoutMs: 1234 })
  assert.equal(shell.resolved.length, 1)
  assert.equal(shell.resolved[0].command, "echo hi")
  assert.equal(shell.resolved[0].timeoutMs, 1234)
  assert.equal(shell.resolved[0].sandboxPolicy, policy)
})

test("timeoutMs 缺省 20000", async () => {
  const shell = fakeShell({ exitCode: 0, timedOut: false, stdout: { text: "" }, stderr: { text: "" } })
  await execViaShell({ shell, policy: undefined, command: "echo hi", timeoutMs: undefined })
  assert.equal(shell.resolved[0].timeoutMs, 20000)
})

test("截断透传：stdout.truncated=true → 结果带 truncated:true", async () => {
  const shell = fakeShell({
    exitCode: 0, timedOut: false,
    stdout: { text: "tail", truncated: true }, stderr: { text: "" },
  })
  const r = await execViaShell({ shell, policy: undefined, command: "cmd", timeoutMs: 1000 })
  assert.equal(r.truncated, true)
  assert.equal(r.stdout, "tail")
})

test("超时路径：timedOut=true 映射", async () => {
  const shell = fakeShell({ exitCode: null, timedOut: true, stdout: { text: "" }, stderr: { text: "" } })
  const r = await execViaShell({ shell, policy: undefined, command: "sleep 99", timeoutMs: 100 })
  assert.equal(r.timedOut, true)
})

test("非零退出：exitCode 原样透传", async () => {
  const shell = fakeShell({ exitCode: 2, timedOut: false, stdout: { text: "" }, stderr: { text: "boom" } })
  const r = await execViaShell({ shell, policy: undefined, command: "false", timeoutMs: 1000 })
  assert.equal(r.exitCode, 2)
  assert.equal(r.stderr, "boom")
})

test("基础设施异常：result() reject → 兜底 exitCode:-1 + stderr 消息", async () => {
  const shell = fakeShell(null, { reject: true })
  const r = await execViaShell({ shell, policy: undefined, command: "cmd", timeoutMs: 1000 })
  assert.equal(r.exitCode, -1)
  assert.equal(r.timedOut, false)
  assert.equal(r.stdout, "")
  assert.match(r.stderr, /subprocess failed/)
})

test("stdout/stderr 缺失字段不抛错（防御 settled-without-output 句柄）", async () => {
  const shell = fakeShell({ exitCode: 0, timedOut: false })
  const r = await execViaShell({ shell, policy: undefined, command: "cmd", timeoutMs: 1000 })
  assert.deepEqual(r, { exitCode: 0, timedOut: false, stdout: "", stderr: "" })
})
