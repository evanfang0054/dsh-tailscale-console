// dsh-tailscale-console — 客户端半区（界面全中文）
// 所有展示内容从宿主 /tsctl/api/config 与 status 动态获取，代码不含任何个人标识。
window.__ModuleLoader__.load({
  id: "dsh-tailscale-console",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")
    const h = React.createElement

    const call = (method, args) =>
      fetch(`/tsctl/api/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args || {}),
      }).then((r) => r.json()).catch((err) => ({ error: String((err && err.message) || err) }))

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [server, setServer] = React.useState(null)
      const [serve, setServe] = React.useState(null)
      const [proxy, setProxy] = React.useState(null)
      const [health, setHealth] = React.useState(null)
      const [busy, setBusy] = React.useState("")
      const [log, setLog] = React.useState("")
      const [notice, setNotice] = React.useState(null)
      const [events, setEvents] = React.useState([])
      const prevPeers = React.useRef({})

      const refresh = React.useCallback(async () => {
        const [c, s, sv, se, pr] = await Promise.all([call("config"), call("status"), call("server"), call("serveStatus"), call("proxy")])
        if (c && !c.error) setCfg(c)
        setStatus(s); setServer(sv); setServe(se); setProxy(pr)
        // 设备上线检测：离线 → 在线 的状态跃迁
        const next = {}
        const fresh = []
        const prev = prevPeers.current
        for (const p of (s && s.peers) || []) {
          next[p.ip] = p.online
          if (prev[p.ip] !== undefined && prev[p.ip] === false && p.online === true) fresh.push(p.name)
        }
        prevPeers.current = next
        if (fresh.length > 0) {
          setEvents((ev) => [...fresh.map((n) => "🎉 " + n + " 已上线"), ...ev].slice(0, 6))
          const base = c && c.tailnetUrl ? c.tailnetUrl : (s && s.tailnetUrl) || ""
          setNotice("设备上线：" + fresh.join("、") + (base ? " —— 可在该设备打开 " + base : ""))
        }
      }, [])

      React.useEffect(() => {
        refresh()
        const timer = (globalThis.setInterval ? setInterval(refresh, 20000) : null)
        return () => { if (timer !== null) clearInterval(timer) }
      }, [])

      const act = async (name, method, args) => {
        setBusy(name); setLog(""); setNotice(null)
        const res = await call(method, args)
        setBusy("")
        if (res.error) setNotice("执行失败: " + res.error)
        else if (res.output !== undefined) setLog(String(res.output))
        if (res.checks) setHealth(res.checks)
        refresh()
      }

      const dshPort = (cfg && cfg.dshPort) || 3080
      const relayPort = (cfg && cfg.relayPort) || 40000
      const cfgUrl = (cfg && cfg.tailnetUrl) || ""
      const selfIp = (status && status.self && status.self.ip) || null
      const selfName = (status && status.self && status.self.name) || "未登录"
      const peers = (status && status.peers) || []
      const serverIp = (server && server.self && server.self.ip) || null
      const tsUrl = cfgUrl || (status && status.tailnetUrl) || ""
      const localUrl = "http://127.0.0.1:" + dshPort
      const startCmd = selfIp
        ? `dsh web --trusted-host ${selfIp}:${dshPort} --trusted-host ${tsUrl || "<tailnet-url>"}`
        : "dsh web --trusted-host <tailnet-ip>:" + dshPort + " --trusted-host <tailnet-url>"
      const isRemotePage = typeof location !== "undefined" && !/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/.test(location.hostname)
      const showProxy = !proxy || proxy.supported !== false

      const aclJson = JSON.stringify({
        grants: [{
          src: [selfIp, ...peers.map((p) => p.ip)].filter(Boolean),
          dst: serverIp ? [serverIp] : ["<中继服务器tailnet IP>"],
          app: { "tailscale.com/cap/relay": [] },
        }],
      }, null, 2)

      const btn = (name, label, onClick, disabled) =>
        h("button", { className: "tspc-btn", disabled: disabled || busy === name, onClick }, busy === name ? "执行中…" : label)

      const card = (title, ...children) =>
        h("div", { className: "tspc-card" }, h("div", { className: "tspc-title" }, title), children)

      const row = (k, v) =>
        h("div", { className: "tspc-row" }, h("span", { className: "tspc-k" }, k), h("span", { className: "tspc-v" }, v))

      const ro = (value) => h("input", { className: "tspc-in", readOnly: true, value: String(value || "") })

      const checkRow = (c) =>
        h("div", { className: "tspc-row" },
          h("span", { className: c.ok ? "tspc-ok" : "tspc-bad" }, c.ok ? "✓" : "✗"),
          h("span", { className: "tspc-k" }, c.name),
          h("span", { className: "tspc-v" }, String(c.detail || "")))

      const deviceRow = (p) =>
        h("div", { className: "tspc-row" },
          h("span", { className: p.online ? "tspc-ok" : "tspc-bad" }, p.online ? "●" : "○"),
          h("span", { className: "tspc-k" }, p.name),
          h("span", { className: "tspc-v" }, p.online ? "在线" : ("离线" + (p.lastSeen ? " " + p.lastSeen : ""))))

      return h("div", { className: "tspc" },
        card("① 设备与上线提醒",
          peers.length ? peers.map(deviceRow) : h("div", { className: "tspc-note" }, "查询中…"),
          events.length ? h("div", { className: "tspc-note" }, events.map((e) => h("div", null, e))) : null,
          h("div", { className: "tspc-note" }, "离线设备上线时自动提醒；20 秒轮询。" + (tsUrl ? " 访问地址：" + tsUrl : "")),
        ),
        card("② 一键健康检查",
          h("div", { className: "tspc-row" },
            btn("health", "开始检查（重启后点这个）", () => act("health", "health")),
            btn("refresh", "刷新状态", refresh)),
          health ? h("div", null, health.map(checkRow)) :
            h("div", { className: "tspc-note" }, "逐项验证 HTTPS 入口、页面、/api 会话列表、/sidebar/api、服务器直连、代理绕过——对应手册「验证清单」。"),
        ),
        card("③ HTTPS 入口 (tailscale serve)",
          row("状态", serve ? (serve.running ? "运行中" : "未开启") : "查询中…"),
          row("地址", ro(serve && serve.url ? serve.url : tsUrl)),
          h("div", { className: "tspc-row" },
            btn("serveOn", "开启", () => act("serveOn", "serveSet", { action: "on" })),
            btn("serveOff", "关闭", () => act("serveOff", "serveSet", { action: "off" })),
          ),
          serve && !serve.running ? h("div", { className: "tspc-warn" },
            isRemotePage
              ? "⚠️ HTTPS 入口已关闭：当前页面经 HTTPS 入口访问，已无法从这里重新开启。请在本机打开 " + localUrl + " 的面板，点「开启」。"
              : "提示：HTTPS 入口已关闭。点「开启」可重新打开（本机访问不受影响）。") : null,
        ),
        showProxy ? card("④ 代理绕过 (Clash Verge)",
          row("*.ts.net 绕过", proxy ? (proxy.tsNet ? "✅ 已配置" : "❌ 缺失——浏览器打不开 HTTPS") : "查询中…"),
          row("100.64.0.0/10", proxy ? (proxy.cgnat ? "✅ 已配置" : "❌ 缺失") : "查询中…"),
          h("div", { className: "tspc-row" },
            btn("proxyApply", "应用绕过列表", () => act("proxyApply", "proxyApply")),
          ),
        ) : null,
        card("⑤ 服务器 (中继)",
          row("Tailscale", server ? (server.installed ? "已安装" : "未安装") : "查询中…"),
          row("Tailnet IP", ro(serverIp)),
          row("中继端口", "UDP " + relayPort + "（云安全组需放行）"),
          h("div", { className: "tspc-row" },
            btn("relay", "开启中继", () => act("relay", "serverRelay"), !serverIp),
            btn("verify", "验证连接", () => act("verify", "verify", { target: serverIp }), !serverIp),
          ),
        ),
        card("⑥ 访问方式",
          row("远程（推荐）", ro(tsUrl)),
          row("本机", ro(localUrl)),
          row("启动命令", ro(startCmd)),
          h("div", { className: "tspc-note" }, "注意：设置/凭据页远程不可用（dsh 特权方法设计，只允许本机）；http://<IP>:端口 仅调试用。"),
        ),
        card("⑦ ACL 授权片段（粘贴到管理后台 Access Controls → JSON 编辑器）",
          h("textarea", { className: "tspc-ta", readOnly: true, rows: 8, value: aclJson }),
          h("div", { className: "tspc-note" }, "src = 需要中继的设备，dst = 服务器；未保存则手机访问走官方海外节点（慢）。"),
        ),
        notice ? h("div", { className: "tspc-notice" }, notice) : null,
        log ? h("div", { className: "tspc-log" }, h("pre", null, log)) : null,
      )
    }

    const CSS = ".tspc{display:flex;flex-direction:column;gap:10px;padding:4px 0;max-width:640px;}" +
      ".tspc-card{border:1px solid rgba(127,127,127,.35);border-radius:10px;padding:12px 14px;background:rgba(127,127,127,.06);}" +
      ".tspc-title{font-weight:600;margin-bottom:8px;}" +
      ".tspc-row{display:flex;align-items:center;gap:8px;margin:4px 0;flex-wrap:wrap;}" +
      ".tspc-k{color:rgba(127,127,127,.9);min-width:120px;font-size:12px;}" +
      ".tspc-v{font-size:13px;word-break:break-all;}" +
      ".tspc-ok{color:#3fb950;font-weight:700;}" +
      ".tspc-bad{color:#f85149;font-weight:700;}" +
      ".tspc-in{flex:1;min-width:220px;background:transparent;border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:4px 8px;font-size:12px;color:inherit;}" +
      ".tspc-ta{width:100%;background:transparent;border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:8px;font-size:12px;color:inherit;font-family:monospace;}" +
      ".tspc-btn{border:1px solid rgba(127,127,127,.45);background:rgba(127,127,127,.1);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;color:inherit;}" +
      ".tspc-btn:disabled{opacity:.45;cursor:not-allowed;}" +
      ".tspc-note{font-size:12px;color:rgba(127,127,127,.85);margin-top:6px;}" +
      ".tspc-warn{border:1px solid rgba(220,140,60,.6);background:rgba(220,140,60,.12);border-radius:8px;padding:8px 10px;font-size:13px;margin-top:6px;}" +
      ".tspc-notice{border:1px solid rgba(60,140,220,.5);background:rgba(60,140,220,.1);border-radius:8px;padding:8px 10px;font-size:13px;}" +
      ".tspc-log{border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:8px 10px;}" +
      ".tspc-log pre{margin:0;font-size:12px;white-space:pre-wrap;word-break:break-all;}"

    exports.apply = function apply(ctx) {
      const slots = ctx.get("slots")
      if (slots === undefined) return
      ctx.effect(() => {
        const style = document.createElement("style")
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      })
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "tailscale-console", order: 50, label: "Tailscale 控制台" },
        () => h(Panel),
      ))
    }
    exports.inject = []

    return module.exports
  },
})
