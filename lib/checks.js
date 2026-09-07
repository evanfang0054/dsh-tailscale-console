// dsh-tailscale-console — 健康检查的纯判定逻辑（无 I/O，node --test 可单测）
//
// 设计约定（与 dsh web 的两层防护对齐）：
// 1. 认证层：/ 首页与 /api RPC 网关要求浏览器会话凭据（launch token 换 cookie），
//    无凭据探测回 401/unauthorized —— 这证明入口与网关活着，属预期行为。
// 2. 信任围层：/sidebar/api（better-sidebar）与 /tsctl/api（本插件）按 Host 信任放行。
// 因此「401/403 = 可达但被拦」与「404/405 = 端点不存在」必须区分判定（issue #1）。

/** 「HTTPS 页面」：curl 裸探首页。200 正常；401 = 入口可达且登录围栏正常。 */
export function pageCheck(code) {
  const c = String(code ?? "").trim()
  if (c === "200") return { ok: true, detail: "HTTP 200" }
  if (c === "401") return { ok: true, detail: "HTTP 401 = 入口可达，登录围栏正常（无凭据探测被拦，预期行为）" }
  return { ok: false, detail: c === "" ? "无响应（超时或连接失败）" : "HTTP " + c }
}

/** 「/api 会话列表」（Host 侧 node:http 直连本机网关）。 */
export function apiProbeCheck(status, raw) {
  const body = String(raw ?? "").trim()
  if (status === 401 || /^unauthorized$/i.test(body)) {
    return { ok: true, detail: "网关可达，要求登录凭据（无凭据 401 属预期；远程浏览器实际访问会带 cookie）" }
  }
  if (status >= 200 && status < 300) {
    try {
      const d = JSON.parse(body)
      const items = d?.result?.value?.items
      if (d?.result?.ok && Array.isArray(items)) return { ok: true, detail: "会话数: " + items.length }
    } catch { /* 落到失败 */ }
    return { ok: false, detail: "2xx 响应不是合法的会话列表 JSON" }
  }
  return { ok: false, detail: status ? "HTTP " + status : "无响应（超时或连接失败）" }
}

/**
 * 「/api 远程 RPC」：经 HTTPS 入口探测远程 RPC 网关（取代失效的 /sidebar/api，
 * issue #1）。200 完整可用；401/403 = 可达但被登录/信任围栏拦下（探测无凭据，
 * 属预期）；404/405 = /api 端点不存在（dsh 版本过旧或部署异常），必须判失败。
 */
export function remoteApiCheck(code) {
  const c = String(code ?? "").trim()
  if (c === "200") return { ok: true, detail: "HTTP 200，远程 RPC 网关可用" }
  if (c === "401") return { ok: true, detail: "HTTP 401 = 入口与网关可达，登录围栏正常（浏览器实际访问带凭据）" }
  if (c === "403") return { ok: true, detail: "HTTP 403 = 入口可达，信任围栏拒绝——检查启动命令 --trusted-host 是否包含该域名" }
  if (c === "404" || c === "405") return { ok: false, detail: `HTTP ${c} = /api 端点不存在（dsh 版本过旧或部署异常）` }
  return { ok: false, detail: c === "" ? "无响应（超时或连接失败）" : "HTTP " + c }
}
