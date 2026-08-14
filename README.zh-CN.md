# dsh-tailscale-console

为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web GUI 提供 **Tailscale 远程访问运营面板**：一键健康检查、HTTPS 入口（Tailscale Serve）开关、macOS 代理绕过修复、中继服务器运维、ACL 片段生成。

界面语言：中文。文档：[English](README.md) · [中文](README.zh-CN.md)

---

## 功能一览

| 卡片 | 说明 |
|---|---|
| ① 设备与上线提醒 | 每台设备在线/离线状态；离线设备上线时自动弹出提醒 |
| ② 一键健康检查 | 一键验证 HTTPS 入口、页面、/api 会话列表、/sidebar/api、服务器直连、代理绕过 |
| ③ HTTPS 入口 | Tailscale Serve 状态/地址 + 开启/关闭（带验证与重试） |
| ④ 代理绕过 | 检查 macOS 系统代理绕过列表中的 `*.ts.net` / `100.64.0.0/10`，一键重新应用（仅 macOS） |
| ⑤ 服务器 | 中继服务器 tailnet 状态 + 开启 Peer Relay + ping 验证 |
| ⑥ 访问方式 | 远程 HTTPS 地址、本机地址、`dsh web` 启动命令 |
| ⑦ ACL 片段 | 按当前设备 IP 自动生成 `tailscale.com/cap/relay` grants JSON |

---

## 完整部署流程（从服务器到本机）

> 目标架构：服务器加入 tailnet 作 **Peer Relay 中继**；本机用 **Tailscale Serve 提供 HTTPS 入口**；DSH 保持只监听 127.0.0.1。

### 0. 前置条件

- Tailscale 账号（建议开启两步验证），MagicDNS 开启
- 一台有公网 IP 的 Linux 服务器（本文以 Ubuntu 22.04 为例）
- 本机 macOS，已安装 tailscale CLI 并登录
- dsh web profile（`~/.dsh/profiles/web`）——需要 **dsh ≥ 0.1.0-rc.6**（`--trusted-host` 与 `webRuntime` 服务）
- **Node 20.x + pnpm ≥ 9**（profile 的 `pnpm-lock.yaml` 是 v9；Node 24 下默认的 pnpm 8 会失败。已在 Node 20.19.2 + pnpm 10.27.0 验证）
- 手机安装 Tailscale App 并登录同一账号（远程访问测试用）

> **如何获取 tailnet 值**（下面尖括号占位符的取法）：
> - 本机 tailnet IP：`tailscale ip -4`
> - 全部设备：`tailscale status`
> - MagicDNS 域名（`<主机名>.<tailnet>.ts.net`）：`tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))"`，或看管理后台 Machines 页，或等 2.1 节 serve 起来后看它的输出
> - 服务器 tailnet IP：在 Mac 上 `tailscale status`（那个 Linux peer）
>
> **技巧**：可以先用默认 `dsh web` 在本机把面板跑起来（回环地址）——面板 ⑥ 卡片会直接显示真实的远程地址、启动命令和 ACL JSON，复制回下面各步即可。

### 1. 服务器端

**1.1 安装并登录 Tailscale**

```bash
ssh <服务器> 'curl -fsSL https://tailscale.com/install.sh | sh'
ssh <服务器> 'nohup tailscale up >/tmp/ts-up.log 2>&1 & sleep 4; cat /tmp/ts-up.log'
# 输出中的 https://login.tailscale.com/a/xxxx 授权链接，浏览器打开并用你的账号授权
# 授权后服务器自动上线；Mac 上 `tailscale status` 应能看到该设备
```

**1.2 开启 Peer Relay 端口 + 防火墙**

```bash
ssh <服务器> 'tailscale set --relay-server-port=40000 && ufw allow 40000/udp && ufw allow 41641/udp'
# 41641 = WireGuard 直连端口；40000 = Peer Relay 中继端口
```

> ⚠️ 云厂商安全组（防火墙）必须同时放行 UDP 40000 和 41641（来源 0.0.0.0/0）——系统 ufw 拦不住云层。

**1.3 验证直连**（本机执行）

```bash
tailscale ping -c 3 <服务器tailnet IP>   # 期望 "via <公网IP>:41641"（几十 ms）；走 DERP 说明 41641 没通
```

### 2. 本机

**2.1 HTTPS 入口：Tailscale Serve（核心）**

```bash
tailscale serve --bg 3080    # https://<主机名>.<tailnet>.ts.net → 127.0.0.1:3080，仅 tailnet 内可访问
tailscale serve status       # 查看；tailscale serve reset 关闭
```

> 为什么必须 HTTPS：浏览器只在安全上下文（HTTPS 或 localhost）提供 `crypto.randomUUID`，DSH 客户端所有 RPC 依赖它。`http://<tailnet IP>:3080` 的 GUI 永远不可用，只能调试。

**2.2 代理绕过（Clash Verge 用户必做）**

本机 Clash 类代理会劫持 ts.net 私有域名导致浏览器打不开。在 Clash Verge 设置 → 系统代理绕过列表加入 `*.ts.net` 与 `100.64.0.0/10`；或立即生效：

```bash
networksetup -getproxybypassdomains "Wi-Fi"   # 先备份当前例外列表
networksetup -setproxybypassdomains "Wi-Fi" "*.ts.net" "100.64.0.0/10" "*.local" "<local>" "localhost" "127.0.0.1" "192.168.0.0/16" "10.0.0.0/8" "172.16.0.0/12"
```

> ⚠️ `-setproxybypassdomains` 会**整体替换**该网络服务的现有例外列表——先 `-getproxybypassdomains` 备份。
> 非 macOS：面板 ④ 卡片自动隐藏；Linux/Windows 请在代理工具或环境变量里加等价绕过，如 `export NO_PROXY="*.ts.net,100.64.0.0/10"`。

**2.3 （可选）socat 备用转发**

```bash
brew install socat
socat TCP-LISTEN:3080,bind=<本机tailnet IP>,reuseaddr,fork TCP:127.0.0.1:3080
# 仅供 curl/API 调试；GUI 不可用（非安全上下文）
```

### 3. DSH 配置

**3.1 启动命令（每次启动都用这个）**

```bash
dsh web --trusted-host <本机tailnet IP>:3080 --trusted-host <主机名>.<tailnet>.ts.net
```

> ⚠️ 下面的每一步改动（cordis.patch.yml、插件代码、better-sidebar 补丁）都**必须重启 `dsh web`**，重启会**中断当前运行的会话**——先保存/结束手头任务。web profile 的 HMR 是关闭的。

**3.2 静态 trustedHosts（双保险）**

`~/.dsh/profiles/web/cordis.patch.yml` 追加：

```yaml
- id: connection
  config:
    trustedHosts: ['<本机tailnet IP>:3080', '<主机名>.<tailnet>.ts.net']
```

**3.3 已知第三方插件问题：`dsh-better-sidebar`**

若你的 profile 装有 `dsh-better-sidebar`，其 `/sidebar/api` 围栏在 **0.10.3（npm 最新版）存在 bug**：`trustedHostsOf()` 用 `entry.options.name` 去匹配 `"connection"`，但 `name` 是包名，永远匹配不上 → 信任列表恒为空 → `/sidebar/api/*` 只认回环（远程 403，侧边栏失效）。上游暂无修复版本。

修补 `node_modules/dsh-better-sidebar/lib/index.js` 的 `trustedHostsOf()`（先备份文件），改为读取 `webRuntime` 服务：

```js
function trustedHostsOf(ctx) {
  const hosts = []
  const runtime = ctx.get("webRuntime")
  if (runtime !== void 0 && Array.isArray(runtime.trustedHosts)) hosts.push(...runtime.trustedHosts)
  for (const entry of ctx.loader.entries()) if (entry.options.id === "connection") {
    const cfg = entry.options.config?.trustedHosts
    if (Array.isArray(cfg)) hosts.push(...cfg)
  }
  return [...new Set(hosts)]
}
```

> ⚠️ 补丁在 `node_modules` 里，**下次 `pnpm install` 会被覆盖，需重新打**（用 `grep -c 'options.id === "connection"'` 检查是否还在）。

### 4. ACL 授权（手机中继必需）

[console.tailscale.com/admin/acls](https://console.tailscale.com/admin/acls) → JSON 编辑器，`grants` 数组加：

```json
{
  "grants": [
    {
      "src": ["<设备A IP>", "<设备B IP>"],
      "dst": ["<服务器tailnet IP>"],
      "app": { "tailscale.com/cap/relay": [] }
    }
  ]
}
```

（src=需要中继的设备，dst=中继服务器。不保存则手机访问绕道官方海外 DERP，400ms+。面板 ⑦ 可自动生成。）

### 5. 安装本插件

> ⚠️ 本包**尚未发布到 npm**——请用下面的本地 `file:` 引用方式（在发布前执行 `pnpm add dsh-tailscale-console` 会报 "Couldn't find package"）。

```bash
cd ~/.dsh/profiles/web
# 需要 Node 20.x + pnpm >= 9（lockfile v9）。已在 Node 20.19.2 + pnpm 10.27.0 验证。
# 1) 把包源码放到 packages/dsh-tailscale-console/（clone / 拷贝本仓库）
# 2) 添加 file: 依赖
pnpm add "dsh-tailscale-console@file:./packages/dsh-tailscale-console"
```

`cordis.patch.yml` 追加：

```yaml
- insert:
    - id: tailscale-console
      name: 'dsh-tailscale-console'
      config:
        sshAlias: my-server    # 可选：服务器端变更操作（安装/中继）用的 ssh 别名
```

重启 `dsh web` → 设置 → Tailscale 控制台。

### 6. 验证清单

```bash
# HTTPS 入口
curl -s -o /dev/null -w "%{http_code}\n" --noproxy '*' https://<主机名>.<tailnet>.ts.net/      # 200
# /api 围栏
curl -s --noproxy '*' -X POST https://<主机名>.<tailnet>.ts.net/api/session.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t-1","method":"session.list","payload":{}}' | head -c 120  # ok:true
# 面板宿主路由
curl -s -o /dev/null -w "%{http_code}\n" --noproxy '*' -X POST \
  https://<主机名>.<tailnet>.ts.net/tsctl/api/config -H 'content-type: application/json' -d '{}'   # 200
# 直连
tailscale ping -c 3 <服务器tailnet IP>
# 最终：任意 tailnet 设备浏览器打开 https://<主机名>.<tailnet>.ts.net，侧边栏可见全部会话
```

---

## 配置参考

所有值来自插件 `Config`；代码不含任何个人标识，MagicDNS 域名与 tailnet IP 未配置时自动派生。

| Key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `dshPort` | number | `3080` | DSH Web GUI 端口 |
| `relayPort` | number | `40000` | 中继服务器 Peer Relay UDP 端口 |
| `tailnetUrl` | string | 自动 | HTTPS 基址，如 `https://myhost.tail1234.ts.net` |
| `sshAlias` | string | — | 服务器端变更操作（安装/中继）的 ssh 别名 |
| `serverPeerPattern` | string | 第一个 Linux peer | 识别中继服务器的主机名正则 |
| `proxyServices` | string[] | macOS 集合 | 应用代理绕过的网络服务列表 |

## 安全模型

- **命令白名单**：每个按钮对应写死的命令；客户端无法传入任意命令。
- **沙箱**：命令以显式 `danger-full-access` 策略执行（与模型 bash 工具一致）。默认 `workspace-write` 会掐掉 `tailscale serve --bg` 的后台派生，导致 HTTPS「开启」失败；风险面由白名单约束。
- **浏览器信任围栏**：`/tsctl/api` 仅接受回环 Host 或 dsh `--trusted-host` 列表中的 Host（与 dsh 官方 `/api` 同款围栏）。
- **平台**：代理绕过卡片仅 macOS 显示，其他平台自动降级。

## 排障

| 症状 | 原因 | 修复 |
|---|---|---|
| 重启后面板消失但宿主路由 200 | `exports` 缺 `"./package.json"`，clientModules 的 `require.resolve('<包>/package.json')` 被 Node exports 封装拦截 | `exports` 补 `"./package.json": "./package.json"` 后重启 |
| 改了源码但服务端仍是旧代码 | pnpm `file:` 依赖是硬链/副本 | 重新软链：`ln -s ../packages/dsh-tailscale-console node_modules/dsh-tailscale-console` |
| HTTPS「开启」静默失败 | 沙箱掐掉 `serve --bg` 的后台派生 | 代码已修（显式策略 + 验证重试） |
| HTTPS 入口关闭后「开启」按钮无效 | 鸡生蛋：入口关闭后 HTTPS 页面本身不可达（连接被拒） | 从本机 `http://127.0.0.1:<端口>` 打开面板重新开启（远程页面会显示引导提示） |
| 远程打不开设置/凭据页（403） | dsh `PRIVILEGED_METHODS` 设计限制 | 本机操作，勿放宽 |
| 手机访问很慢 | ACL grants 未保存 | 见第 4 节 |

## 许可证

MIT。浏览器信任围栏逻辑镜像 dsh 的 `api-request-trust`（见 `@deepseek-ai/dsh-client-connection`）。
