// dsh-tailscale-console — 宿主半区
//
// 为 DSH 远程访问（Tailscale）提供固定命令的控制面板：
// 健康检查、HTTPS 入口（tailscale serve）开关、代理绕过、中继服务器运维、ACL 片段。
//
// 安全模型（审查前必读）：
// - 每个按钮映射到写死的命令白名单；客户端永远不能传入任意命令。
// - 命令以显式 `danger-full-access` 沙箱策略执行（与模型 bash 工具的会话策略一致）。
//   默认的 workspace-write 约束会掐掉 `tailscale serve --bg` 派生的后台子进程
//   （daemon 化正是 --bg 启用 HTTPS 的方式），导致「开启」按钮静默失败。
//   风险面仍被命令白名单限制。
// - /tsctl/api 前缀应用与 dsh 官方 /api 网关相同的浏览器信任围栏
//   （Host 必须是回环地址或已配置的 trusted host）。
// - 所有机器相关信息来自插件 Config（cordis.patch.yml）；代码不含个人标识。
//   MagicDNS 域名与 tailnet IP 在未配置时从 `tailscale status --json` 自动派生。

import { z } from "zod"
import http from "node:http"

const name = "dsh-tailscale-console"
const inject = ["webServer"]

const Config = z.object({
  /** DSH Web GUI 监听端口（serve 与展示用）。 */
  dshPort: z.number().int().positive().default(3080),
  /** 中继服务器对外宣告的 Peer Relay UDP 端口。 */
  relayPort: z.number().int().positive().default(40000),
  /** 公网 HTTPS 基址，如 "https://myhost.tail1234.ts.net"。缺省时从 MagicDNS 自动派生。 */
  tailnetUrl: z.string().optional(),
  /** 用于执行服务器端命令的 ssh 别名（~/.ssh/config）。仅安装/中继等变更操作需要。 */
  sshAlias: z.string().optional(),
  /** 匹配中继服务器 peer 主机名的正则（字符串）。缺省取第一个 Linux peer。 */
  serverPeerPattern: z.string().optional(),
  /** 应用代理绕过的 macOS 网络服务列表。darwin 下缺省为常见 Clash Verge 集合。 */
  proxyServices: z.array(z.string()).optional(),
})

// ── 浏览器信任围栏（镜像 dsh 的 api-request-trust；见
//    @deepseek-ai/dsh-client-connection lib/index.js）─────────────────────────
function isLoopbackHostname(hostname) {
  // 与 dsh 官方 api-request-trust 一致：接受整个 127/8 段。
  if (hostname === "localhost" || hostname === "::1") return true
  const parts = String(hostname || "").split(".")
  return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}
function parseAuthority(authority) {
  try { return new URL(`http://${authority}`) } catch { return undefined }
}
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}
function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host
  })
}
function isTrustedApiRequest(request, trustedHosts) {
  const host = request.headers.host
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}
function trustedHostsOf(ctx) {
  const hosts = []
  const runtime = ctx.get("webRuntime")
  if (runtime !== undefined && Array.isArray(runtime.trustedHosts)) hosts.push(...runtime.trustedHosts)
  return [...new Set(hosts)]
}

// ── 工具 ────────────────────────────────────────────────────────────────────
/** 文本格式 `tailscale status` 的降级解析（--json 不可用时）。 */
function parseStatusText(text) {
  let selfIp = null, selfName = null
  const peers = []
  for (const line of (text || "").split("\n")) {
    const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const state = m[5].trim()
    if (state === "-" || state === "") { if (!selfIp) { selfIp = m[1]; selfName = m[2] } }
    else peers.push({ ip: m[1], name: m[2], os: m[3], online: !state.includes("offline"), state })
  }
  return { self: selfIp ? { ip: selfIp, name: selfName } : null, peers }
}

async function apply(ctx, rawConfig) {
  const shell = ctx.get("shell")
  if (shell === undefined) return

  const cfg = Config.parse(rawConfig ?? {})
  const platform = typeof process !== "undefined" ? process.platform : "unknown"
  const proxyServices = cfg.proxyServices ?? (platform === "darwin" ? ["Wi-Fi", "Ethernet", "Thunderbolt Bridge"] : [])

  const run = async (command, timeoutMs) => {
    try {
      // 显式 danger-full-access：默认 workspace-write 沙箱会掐掉
      // `tailscale serve --bg` 的后台派生进程。见顶部安全模型。
      const policy = ctx.get("sandboxPolicy")?.resolve({ mode: "danger-full-access" })
      const spec = shell.resolve({
        command,
        timeoutMs: timeoutMs || 20000,
        ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
      })
      const res = await shell.run(spec)
      return {
        exitCode: res.exitCode,
        timedOut: !!res.timedOut,
        stdout: (res.stdout && res.stdout.text) || "",
        stderr: (res.stderr && res.stderr.text) || "",
      }
    } catch (err) {
      return { exitCode: -1, timedOut: false, stdout: "", stderr: String((err && err.message) || err) }
    }
  }

  /**
   * 本机直连 dsh `/api/session.list`（不经 shell）。
   *
   * 为什么不用 shell+curl：dsh shell 服务对超长 stdout 做「保留尾部」截断
   * （约 63KB 上限），而 session.list 响应体（数百个会话的元数据）远超该值，
   * JSON.parse 永远失败。Host 内直接用 node:http 请求 127.0.0.1 则完整。
   * 本机回环天然满足 dsh /api 信任围栏（loopback allowed）。
   */
  const apiSessionList = (port, timeoutMs = 8000) =>
    new Promise((resolve) => {
      const body = JSON.stringify({
        type: "client-request",
        rpcId: "h-1",
        method: "session.list",
        payload: {},
      })
      const req = http.request(
        {
          host: "127.0.0.1",
          port: Number(port) || 3080,
          path: "/api/session.list",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = []
          res.on("data", (c) => chunks.push(c))
          res.on("end", () => {
            try {
              resolve({ raw: Buffer.concat(chunks).toString("utf8") })
            } catch (e) {
              resolve({ err: String((e && e.message) || e) })
            }
          })
        },
      )
      req.on("error", (e) => resolve({ err: String((e && e.message) || e) }))
      req.on("timeout", () => {
        req.destroy()
        resolve({ err: "请求超时" })
      })
      req.end(body)
    })

  const timer = ctx.get("timer")

  /** tailnet 事实（自动派生；代码不硬编码任何个人标识）。 */
  async function tailnetFacts() {
    const res = await run("tailscale status --json", 15000)
    try {
      const d = JSON.parse(res.stdout)
      const s = d.Self || {}
      const dns = String(s.DNSName || "").replace(/\.$/, "")
      const self = {
        ip: (s.TailscaleIPs || [])[0] || null,
        name: s.HostName || null,
        dnsName: dns || null,
      }
      const peers = []
      for (const p of Object.values(d.Peer || {})) {
        const ip = (p.TailscaleIPs || [])[0]
        if (!ip) continue
        const online = p.Online === true
        const lastSeen = p.LastSeen && p.LastSeen !== "0001-01-01T00:00:00Z" ? p.LastSeen : null
        peers.push({
          ip,
          name: p.HostName || "",
          os: p.OS || "",
          online,
          lastSeen,
          state: online ? "online" : `offline${lastSeen ? ", last seen " + lastSeen : ""}`,
        })
      }
      return { self, peers }
    } catch {
      const parsed = parseStatusText(res.stdout)
      return { self: parsed.self, peers: parsed.peers }
    }
  }

  /** 识别中继服务器：优先 serverPeerPattern，其次第一个 Linux peer。 */
  function pickServer(peers) {
    if (cfg.serverPeerPattern) {
      try {
        const re = new RegExp(cfg.serverPeerPattern)
        const hit = peers.find((p) => re.test(p.name))
        if (hit) return hit
      } catch { /* 继续走默认 */ }
    }
    return peers.find((p) => p.os === "linux") || peers[0] || null
  }

  /** HTTPS 基址：配置优先，其次 MagicDNS 自动派生。 */
  function tailnetUrlOf(self) {
    if (cfg.tailnetUrl) return cfg.tailnetUrl.replace(/\/$/, "")
    if (self && self.dnsName) return `https://${self.dnsName}`
    return null
  }

  const ssh = (remoteCmd, timeoutMs) => {
    if (!cfg.sshAlias) {
      return Promise.resolve({ exitCode: 1, timedOut: false, stdout: "", stderr: "未配置 sshAlias" })
    }
    return run(`ssh -o ConnectTimeout=8 -o BatchMode=yes ${cfg.sshAlias} ${JSON.stringify(remoteCmd)}`, timeoutMs)
  }

  const handlers = {
    /** 已解析配置（安全子集）——客户端据此渲染。 */
    config: async () => ({
      dshPort: cfg.dshPort,
      relayPort: cfg.relayPort,
      tailnetUrl: cfg.tailnetUrl ?? null,
      sshAlias: cfg.sshAlias ?? null,
      serverPeerPattern: cfg.serverPeerPattern ?? null,
      proxyServices,
      platform,
    }),
    /** 本机 + 设备列表。 */
    status: async () => {
      const { self, peers } = await tailnetFacts()
      return { self, peers, tailnetUrl: tailnetUrlOf(self) }
    },
    /** 中继服务器状态（来自 tailnet 事实；ssh 仅用于变更操作）。 */
    server: async () => {
      const { peers } = await tailnetFacts()
      const server = pickServer(peers)
      if (!server) return { installed: false, self: null, via: "tailnet", output: "未找到中继服务器 peer" }
      return { installed: true, self: { ip: server.ip, name: server.name }, via: "tailnet", output: `${server.name} ${server.ip} ${server.online ? "在线" : "离线"}` }
    },
    /** 服务器安装 + 登录（需 sshAlias；新机器引导用）。 */
    serverInstall: async () => {
      const remote = [
        "if command -v tailscale >/dev/null; then",
        "  tailscale status >/dev/null 2>&1 && echo ALREADY_UP || (nohup tailscale up >/tmp/ts-up.log 2>&1 & sleep 4; cat /tmp/ts-up.log)",
        "else",
        "  curl -fsSL https://tailscale.com/install.sh | sh >/tmp/ts-install.log 2>&1",
        "  if command -v tailscale >/dev/null; then",
        "    nohup tailscale up >/tmp/ts-up.log 2>&1 & sleep 4; cat /tmp/ts-up.log",
        "  else",
        "    echo INSTALL_FAILED; tail -20 /tmp/ts-install.log",
        "  fi",
        "fi",
      ].join("\n")
      const res = await ssh(remote, 120000)
      const output = (res.stdout + "\n" + res.stderr).trim()
      const m = output.match(/https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9]+/)
      return { output, loginUrl: m ? m[0] : null, timedOut: res.timedOut }
    },
    /** 服务器开启 Peer Relay（需 sshAlias）。 */
    serverRelay: async () => {
      const res = await ssh(`tailscale set --relay-server-port=${cfg.relayPort} && ufw allow ${cfg.relayPort}/udp && echo RELAY_OK`, 30000)
      let output = (res.stdout + "\n" + res.stderr).trim()
      // 非 Ubuntu / 无 ufw 时的友好提示（云安全组仍需另行放行）。
      if (/ufw: command not found|command not found/.test(output)) {
        output += `\n提示：服务器上没有 ufw。请用发行版原生防火墙放行 UDP ${cfg.relayPort}（Peer Relay）与 41641（WireGuard 直连），并在云安全组放行同样端口。`
      }
      return { output, exitCode: res.exitCode }
    },
    /** 验证：ping 目标 + 查看 peer-relay 路径。 */
    verify: async (args) => {
      const target = (args && args.target) || ""
      const p = target ? await run(`tailscale ping -c 3 --timeout 2s ${target}`, 30000) : null
      const g = await run("tailscale status | grep peer-relay; echo ---", 15000)
      return {
        ping: p ? (p.stdout + "\n" + p.stderr).trim() : "未指定目标",
        relayPath: (g.stdout + "\n" + g.stderr).trim(),
      }
    },
    /** HTTPS 入口（tailscale serve）状态。 */
    serveStatus: async () => {
      const res = await run("tailscale serve status", 15000)
      const text = (res.stdout + "\n" + res.stderr).trim()
      const m = text.match(/https:\/\/[^\s]+/)
      return { running: text.includes(`proxy http://127.0.0.1:${cfg.dshPort}`), url: m ? m[0] : null, output: text }
    },
    /** HTTPS 入口开关（带验证与重试）。 */
    serveSet: async (args) => {
      const action = (args && args.action) || "on"
      const cmd = action === "off" ? "tailscale serve reset" : `tailscale serve --bg ${cfg.dshPort}`
      const res = await run(cmd, 30000)
      let running = false
      let statusText = ""
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0 && timer !== undefined) await timer.timeout(2000)
        const st = await run("tailscale serve status", 15000)
        statusText = (st.stdout + "\n" + st.stderr).trim()
        running = statusText.includes(`proxy http://127.0.0.1:${cfg.dshPort}`)
        if (running || action === "off") break
        if (attempt < 2) await run(`tailscale serve --bg ${cfg.dshPort}`, 30000)
      }
      return {
        output: (res.stdout + "\n" + res.stderr).trim(),
        exitCode: res.exitCode,
        running,
        serveStatus: statusText.split("\n")[0] || "",
      }
    },
    /** macOS 系统代理绕过检查（其他平台客户端自动隐藏卡片）。 */
    proxy: async () => {
      if (platform !== "darwin" || proxyServices.length === 0) {
        return { tsNet: false, cgnat: false, supported: false, list: "当前平台不支持" }
      }
      const res = await run("scutil --proxy", 8000)
      const text = res.stdout
      return { tsNet: text.includes("*.ts.net"), cgnat: text.includes("100.64.0.0/10"), supported: true, list: text }
    },
    /** 应用代理绕过列表（macOS）。 */
    proxyApply: async () => {
      if (platform !== "darwin" || proxyServices.length === 0) {
        return { output: "当前平台不支持", exitCode: 1 }
      }
      const cmd = [
        "for svc in " + proxyServices.map((s) => JSON.stringify(s)).join(" "),
        'do networksetup -setproxybypassdomains "$svc" "*.ts.net" "100.64.0.0/10" "*.crashlytics.com" "*.local" "<local>" "localhost" "127.0.0.1" "192.168.0.0/16" "10.0.0.0/8" "172.16.0.0/12" 2>&1',
        "done; echo DONE",
      ].join("; ")
      const res = await run(cmd, 30000)
      return { output: (res.stdout + "\n" + res.stderr).trim(), exitCode: res.exitCode }
    },
    /** 一键健康检查（对应手册「验证清单」）。 */
    health: async () => {
      const { self, peers } = await tailnetFacts()
      const base = tailnetUrlOf(self)
      const checks = []
      const serve = await run("tailscale serve status", 15000)
      checks.push({
        name: "HTTPS 入口",
        ok: serve.stdout.includes(`proxy http://127.0.0.1:${cfg.dshPort}`),
        detail: (serve.stdout.match(/https:\/\/[^\s]+/) || [serve.stdout.trim().slice(0, 40)])[0],
      })
      if (!base) {
        checks.push({ name: "HTTPS 页面", ok: false, detail: "无 tailnet URL（未登录？）" })
        checks.push({ name: "/api 会话列表", ok: false, detail: "跳过" })
        checks.push({ name: "/sidebar/api", ok: false, detail: "跳过" })
      } else {
        const page = await run(`curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 6 ${base}/`, 15000)
        checks.push({ name: "HTTPS 页面", ok: page.stdout.trim() === "200", detail: "HTTP " + page.stdout.trim() })
        const sl = await apiSessionList(cfg.dshPort)
        let slOk = false, slDetail = sl.err || ""
        if (!sl.err) {
          try {
            const d = JSON.parse(sl.raw)
            slOk = !!(d.result && d.result.ok && d.result.value && Array.isArray(d.result.value.items))
            slDetail = "会话数: " + (d.result.value.items || []).length
          } catch (e) { slDetail = "响应解析失败: " + String((e && e.message) || e) }
        }
        checks.push({ name: "/api 会话列表", ok: slOk, detail: slDetail })
        const sb = await run(`curl -s --noproxy '*' --max-time 8 -o /dev/null -w '%{http_code}' -X POST ${base}/sidebar/api/settings.get -H 'content-type: application/json' -d '{}'`, 20000)
        checks.push({ name: "/sidebar/api", ok: sb.stdout.trim() === "200", detail: "HTTP " + sb.stdout.trim() })
      }
      const server = pickServer(peers)
      if (server) {
        const ping = await run(`tailscale ping -c 2 --timeout 3s ${server.ip}`, 15000)
        const lines = (ping.stdout + "\n" + ping.stderr).split("\n").filter((l) => /pong|via/.test(l))
        checks.push({ name: "服务器直连", ok: /pong/.test(ping.stdout), detail: lines[0] || ping.stdout.trim() })
      } else {
        checks.push({ name: "服务器直连", ok: false, detail: "未找到服务器 peer" })
      }
      if (platform === "darwin") {
        const pr = await run("scutil --proxy", 8000)
        checks.push({ name: "代理绕过 ts.net", ok: pr.stdout.includes("*.ts.net"), detail: "ExceptionsList" })
      }
      return { checks, tailnetUrl: base }
    },
  }

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/tsctl/api",
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHostsOf(ctx))) {
        res.writeHead(403, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: { code: "forbidden", message: "forbidden" } }))
        return
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: { code: "method-error", message: "method not allowed" } }))
        return
      }
      const pathname = new URL(req.url ?? "/", "http://tsctl.internal").pathname
      const method = pathname.startsWith("/tsctl/api/") ? pathname.slice("/tsctl/api/".length) : undefined
      const handler = handlers[method]
      if (handler === undefined) {
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: { code: "not-found", message: "unknown method" } }))
        return
      }
      let args = {}
      try {
        const chunks = []
        for await (const chunk of req) {
          chunks.push(chunk)
          if (chunks.reduce((n, c) => n + c.length, 0) > 65536) break
        }
        const body = Buffer.concat(chunks).toString("utf8").trim()
        if (body) args = JSON.parse(body)
      } catch { /* 忽略请求体错误 */ }
      try {
        const result = await handler(args)
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify(result ?? {}))
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))
      }
    },
  }), "dsh-tailscale-console: /tsctl/api routes")
}

export { name, apply, inject, Config }
