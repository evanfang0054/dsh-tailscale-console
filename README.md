# dsh-tailscale-console

A control panel for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web GUI that operates **secure remote access over Tailscale**: one-click health checks, HTTPS entry (Tailscale Serve) toggle, macOS proxy bypass repair, relay-server ops, and an ACL snippet generator.

UI language: Chinese. Docs: [English](README.md) · [中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/dsh-tailscale-console.svg?style=flat-square)](https://www.npmjs.com/package/dsh-tailscale-console)
[![License](https://img.shields.io/npm/l/dsh-tailscale-console.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg?style=flat-square)](package.json)
[![Downloads](https://img.shields.io/npm/dm/dsh-tailscale-console.svg?style=flat-square)](https://www.npmjs.com/package/dsh-tailscale-console)
[![dsh plugin](https://img.shields.io/badge/dsh%20plugin-ready-2ea44f.svg?style=flat-square)](https://github.com/topics/dsh-plugin)

---

## Features

| Card | Description |
|---|---|
| ① Devices & online alerts | Per-device online/offline state; auto-alerts when an offline device comes online |
| ② Health check | One-click verification of HTTPS entry, page, `/api` session list, `/sidebar/api`, server direct path, proxy bypass |
| ③ HTTPS entry | Tailscale Serve status / URL + on/off toggle (with verification & retry) |
| ④ Proxy bypass | Checks `*.ts.net` / `100.64.0.0/10` in the macOS system proxy bypass list; one-click re-apply (macOS only) |
| ⑤ Relay server | Tailnet status of your relay server + enable Peer Relay + ping verify |
| ⑥ Access | Remote HTTPS URL, local URL, and the exact `dsh web` start command |
| ⑦ ACL snippet | Generates the `tailscale.com/cap/relay` grants JSON from live device IPs |

---

## Full Setup Guide (server → local machine → DSH)

> Target architecture: the server joins the tailnet as a **Peer Relay**; the local machine exposes **HTTPS via Tailscale Serve**; DSH keeps listening on 127.0.0.1 only.

### 0. Prerequisites

- Tailscale account (enable 2FA), MagicDNS enabled
- A Linux server with a public IP (Ubuntu 22.04 in this guide)
- Local macOS with the `tailscale` CLI installed and logged in
- A dsh web profile (`~/.dsh/profiles/web`) — requires **dsh ≥ 0.1.0-rc.6** (for `--trusted-host` and the `webRuntime` service)
- **Node 20.x + pnpm ≥ 9** for the profile (`pnpm-lock.yaml` is v9; the default pnpm 8 under Node 24 will fail. Verified with Node 20.19.2 + pnpm 10.27.0)
- A phone with the Tailscale app installed and logged into the same account (for remote access testing)

> **How to find your tailnet values** (the `<...>` placeholders below):
> - Local tailnet IP: `tailscale ip -4`
> - All devices: `tailscale status`
> - MagicDNS name (`<hostname>.<tailnet>.ts.net`): `tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))"`, or read it from the Tailscale admin console → Machines, or from the output of `tailscale serve status` once serve is up (section 2.1)
> - Server tailnet IP: `tailscale status` on the Mac (the Linux peer)
>
> **Tip**: you can bring the panel up locally first with `dsh web` (loopback default) — card ⑥ then shows the real remote URL, start command and ACL JSON, which you can copy back into the steps below.

### 1. Server side

**1.1 Install & authenticate Tailscale**

```bash
ssh <server> 'curl -fsSL https://tailscale.com/install.sh | sh'
ssh <server> 'nohup tailscale up >/tmp/ts-up.log 2>&1 & sleep 4; cat /tmp/ts-up.log'
# Open the https://login.tailscale.com/a/xxxx link printed, authorize with your account.
# The server comes online automatically; `tailscale status` on the Mac should list it.
```

**1.2 Enable the Peer Relay port + firewall**

```bash
ssh <server> 'tailscale set --relay-server-port=40000 && ufw allow 40000/udp && ufw allow 41641/udp'
# 41641 = WireGuard direct port; 40000 = Peer Relay port
```

> ⚠️ Your cloud security group must also allow inbound UDP 40000 and 41641 (source 0.0.0.0/0) — the guest ufw cannot protect the cloud edge.

**1.3 Verify the direct path** (run on the Mac)

```bash
tailscale ping -c 3 <server-tailnet-ip>   # expect "via <public-ip>:41641" (tens of ms); DERP means 41641 is blocked
```

### 2. Local machine

**2.1 HTTPS entry: Tailscale Serve (the core)**

```bash
tailscale serve --bg 3080    # https://<hostname>.<tailnet>.ts.net → 127.0.0.1:3080, tailnet-only
tailscale serve status       # inspect; `tailscale serve reset` to disable
```

> Why HTTPS is mandatory: browsers expose `crypto.randomUUID` only in secure contexts (HTTPS or localhost), and every DSH client RPC depends on it. The GUI at `http://<tailnet-ip>:3080` will never work — debug only.

**2.2 Proxy bypass (required if you run Clash-family proxies on macOS)**

A local Clash proxy hijacks the private ts.net domain and breaks HTTPS in the browser. Add `*.ts.net` and `100.64.0.0/10` to the bypass list in Clash Verge → Settings → System proxy; or apply immediately:

```bash
networksetup -getproxybypassdomains "Wi-Fi"   # first: back up the current list
networksetup -setproxybypassdomains "Wi-Fi" "*.ts.net" "100.64.0.0/10" "*.local" "<local>" "localhost" "127.0.0.1" "192.168.0.0/16" "10.0.0.0/8" "172.16.0.0/12"
```

> ⚠️ `-setproxybypassdomains` **replaces** the whole exception list of that service — back it up first with `-getproxybypassdomains`.
> Non-macOS: the panel hides card ④ automatically; for Linux/Windows set the equivalent bypass, e.g. `export NO_PROXY="*.ts.net,100.64.0.0/10"` in your proxy tool or environment.

**2.3 (Optional) socat debug forward**

```bash
brew install socat
socat TCP-LISTEN:3080,bind=<local-tailnet-ip>,reuseaddr,fork TCP:127.0.0.1:3080
# curl/API debugging only; the GUI is unusable over plain HTTP (non-secure context)
```

### 3. DSH configuration

**3.1 Start command (use this every time)**

```bash
dsh web --trusted-host <local-tailnet-ip>:3080 --trusted-host <hostname>.<tailnet>.ts.net
```

> ⚠️ Every change below (cordis.patch.yml, plugin code, better-sidebar patch) requires **restarting `dsh web`**, which **interrupts the currently running session** — save/finish your work first. The web profile has HMR disabled.

**3.2 Static trustedHosts (belt & braces)**

Append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: connection
  config:
    trustedHosts: ['<local-tailnet-ip>:3080', '<hostname>.<tailnet>.ts.net']
```

**3.3 Known third-party issue: `dsh-better-sidebar`**

If your profile installs `dsh-better-sidebar`, its `/sidebar/api` fence has a bug **in version 0.10.3 (the latest published)**: `trustedHostsOf()` matches `entry.options.name` against `"connection"`, but `name` is the package name, so the trust list is always empty and `/sidebar/api/*` is loopback-only (403 remotely — the sidebar breaks). No fixed upstream version exists yet.

Patch `trustedHostsOf()` in `node_modules/dsh-better-sidebar/lib/index.js` (back up the file first) to read the `webRuntime` service:

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

> ⚠️ The patch lives in `node_modules` and is lost on the next `pnpm install` — re-apply after every reinstall (check with `grep -c 'options.id === "connection"'`).

### 4. ACL grant (required for phone relaying)

[console.tailscale.com/admin/acls](https://console.tailscale.com/admin/acls) → JSON editor, add to `grants`:

```json
{
  "grants": [
    {
      "src": ["<device-A-ip>", "<device-B-ip>"],
      "dst": ["<server-tailnet-ip>"],
      "app": { "tailscale.com/cap/relay": [] }
    }
  ]
}
```

(`src` = devices allowed to relay, `dst` = the relay server. Without it, phone traffic falls back to official DERP, 400ms+. Card ⑦ generates this for you.)

### 5. Install this plugin

The package declares `dsh.bundle`, so the official CLI installs **and auto-mounts** it into the profile's bundle stack — one command, no profile file edits:

```bash
# npm source (published): auto-appends to dsh.profile.bundles + mounts
dsh plugin --profile web add dsh-tailscale-console

# or install straight from the repo (also auto-mounts — the repo ships cordis.patch.yml at its root)
dsh plugin --profile web add github:evanfang0054/dsh-tailscale-console
```

Restart `dsh web` → Settings → Tailscale Console.

Optional per-user options (like `sshAlias`) are machine-specific and are **not** part of the bundled patch. Override them from the profile's own `cordis.patch.yml` by targeting the same entry id:

```bash
cd ~/.dsh/profiles/web
pnpm add "dsh-tailscale-console@file:./packages/dsh-tailscale-console"   # local dev: file: reference
```

```yaml
# append to ~/.dsh/profiles/web/cordis.patch.yml (optional overrides)
- id: tailscale-console
  config:
    sshAlias: my-server    # optional: ssh alias for server-side mutations (install/relay)
```

> ⚠️ If you previously mounted this plugin the manual way (an `- insert:` line in `cordis.patch.yml`), remove that line before switching to the `dsh plugin add` bundle channel — keeping both double-mounts the plugin (two host halves, two panels).

### 6. Verification checklist

```bash
# HTTPS entry
curl -s -o /dev/null -w "%{http_code}\n" --noproxy '*' https://<hostname>.<tailnet>.ts.net/      # 200
# /api fence
curl -s --noproxy '*' -X POST https://<hostname>.<tailnet>.ts.net/api/session.list \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"t-1","method":"session.list","payload":{}}' | head -c 120  # ok:true
# panel host route
curl -s -o /dev/null -w "%{http_code}\n" --noproxy '*' -X POST \
  https://<hostname>.<tailnet>.ts.net/tsctl/api/config -H 'content-type: application/json' -d '{}'   # 200
# direct path
tailscale ping -c 3 <server-tailnet-ip>
# Final: open https://<hostname>.<tailnet>.ts.net on any tailnet device — the sidebar lists all sessions
```

---

## Configuration

All values come from the plugin `Config`; the code contains **no personal identifiers**. MagicDNS URLs and tailnet IPs are auto-derived from `tailscale status --json` when not configured.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `dshPort` | number | `3080` | DSH web GUI port |
| `relayPort` | number | `40000` | Relay server's Peer Relay UDP port |
| `tailnetUrl` | string | auto | HTTPS base, e.g. `https://myhost.tail1234.ts.net` |
| `sshAlias` | string | — | SSH alias for server-side mutations (install / relay) |
| `serverPeerPattern` | string | first Linux peer | Regex to identify the relay server peer |
| `proxyServices` | string[] | macOS set | Network services for the bypass apply |

## Security model

- **Fixed command allowlist**: every button maps to a hard-coded command; the client cannot pass free-form input.
- **Sandbox**: commands run with an explicit `danger-full-access` sandbox policy (same as the model's bash tool session policy). The default `workspace-write` confinement kills the detached child of `tailscale serve --bg`, breaking the HTTPS "on" toggle. Blast radius stays bounded by the allowlist.
- **Browser-trust fence**: the `/tsctl/api` prefix accepts only loopback Hosts or hosts in dsh's `--trusted-host` list (same fence as dsh's own `/api`).
- **Platform**: proxy bypass cards are macOS-only; other platforms degrade gracefully.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Panel missing after restart, host route 200 | `exports` lacks `"./package.json"` — client scan (`require.resolve('<pkg>/package.json')`) is blocked by Node exports encapsulation | add `"./package.json": "./package.json"` to `exports`; restart |
| Stale code served after editing sources | pnpm `file:` deps are hard-linked copies | re-symlink: `ln -s ../packages/dsh-tailscale-console node_modules/dsh-tailscale-console` |
| HTTPS "on" fails silently | sandbox kills `serve --bg`'s daemon | fixed in code (explicit policy + verify/retry) |
| "On" button dead after HTTPS entry is off | chicken-and-egg: the HTTPS page itself is unreachable once serve is off (connection refused) | open the panel at `http://127.0.0.1:<port>` on the local machine and toggle on (remote page shows a hint) |
| Settings/credentials page 403 remotely | dsh `PRIVILEGED_METHODS` design limit | operate locally; do not relax |
| Phone access is slow | ACL grants not saved | see section 4 |
| `tailscale ping` (TSMP) works, but real TCP/ICMP all time out | control-plane ACL lost the default allow rule (only custom rules like the Peer Relay grant remain); tailscaled logs show `Drop: ... no rules matched` | re-add the default rule at the top of `grants` (below) — propagates in ~30s, no restart |

**Default ACL rule (new `grants` format — three requirements)**

When configuring a Peer Relay, the default "allow all connections" rule is easily overwritten. Once lost, every real packet is dropped by the ACL filter with `no rules matched`, while TSMP ping keeps working (internal path, bypasses ACL) — the classic "ping works, data doesn't" illusion. Always keep the default rule first:

```json
{
  "grants": [
    { "src": ["*"], "dst": ["*"], "ip": ["*"] },
    { "src": ["<device IP>"], "dst": ["<relay server IP>"],
      "app": { "tailscale.com/cap/relay": [] } }
  ]
}
```

New `grants` requirements: `dst` takes no port; an explicit `ip` field is mandatory; `app` and `ip` cannot both be empty.

Inspect commands:
- Server: `journalctl -u tailscaled | grep "no rules matched"`
- macOS: `log show --last 30m --predicate 'eventMessage CONTAINS "no rules matched"'`

## License

MIT. The browser-trust fence mirrors dsh's `api-request-trust` logic (see `@deepseek-ai/dsh-client-connection`).
