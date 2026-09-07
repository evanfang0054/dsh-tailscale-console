// 设备端配对页：单文件 HTML（无外部依赖），供远程设备作为长期书签。
// 输入 Mac 面板生成的 8 位配对码 → GET /tsctl/pair?c=码 → 单次兑换并种上会话 cookie。
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function renderPairPage({ error } = {}) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 设备配对</title><style>
:root{color-scheme:light dark}
body{font-family:-apple-system,'Segoe UI',sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7f9;color:#1a1c1e;margin:0}
@media (prefers-color-scheme: dark){body{background:#16181d;color:#e6e6e6}}
.box{max-width:420px;padding:28px;border:1px solid rgba(127,127,127,.35);border-radius:14px;background:rgba(127,127,127,.06)}
h2{margin:0 0 6px;font-size:20px}
p.lead{margin:6px 0 14px;font-size:13px;opacity:.8}
input{width:100%;box-sizing:border-box;font-size:22px;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:10px;border:1px solid rgba(127,127,127,.45);border-radius:8px;background:transparent;color:inherit}
button{width:100%;margin-top:12px;padding:10px;border:0;border-radius:8px;background:#2f6feb;color:#fff;font-size:16px;cursor:pointer}
.pair-error{color:#f85149;font-weight:600;margin-top:10px;font-size:14px}
details{margin-top:18px;font-size:13px;opacity:.85}summary{cursor:pointer;padding:4px 0}li{margin:6px 0}
</style></head><body><div class="box">
<h2>DSH 设备配对</h2>
<p class="lead">输入 Mac 面板「设备配对」生成的 8 位配对码（10 分钟内有效，单次使用）。</p>
<form method="get" action="/tsctl/pair"><input name="c" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autofocus><button type="submit">配对并登录</button></form>
${error ? `<div class="pair-error">${esc(error)}</div>` : ""}
<details><summary>📱 添加到主屏幕（像 APP 一样使用）</summary><ul>
<li><b>iOS Safari</b>：配对成功后 → 分享按钮 → 「添加到主屏幕」</li>
<li><b>Android Chrome</b>：配对成功后 → 菜单 ⋮ → 「添加到主屏幕 / 安装应用」</li>
</ul></details>
<details><summary>ℹ️ 常见问题</summary><ul>
<li>提示码无效：码只能使用一次且 10 分钟过期，请在 Mac 面板重新生成</li>
<li>本页面可加入书签，登录过期后直接打开输新码即可，无需重装 APP</li>
</ul></details>
</div></body></html>`
}
