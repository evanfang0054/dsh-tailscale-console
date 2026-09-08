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
<p class="lead">输入 Mac 面板「设备配对」生成的 8 位配对码（10 分钟内有效，可多台设备使用）。</p>
<form method="get" action="/tsctl/pair"><input name="c" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off" autofocus><button type="submit">配对并登录</button></form>
${error ? `<div class="pair-error">${esc(error)}</div>` : ""}
<details><summary>📱 添加到主屏幕（像 APP 一样使用）</summary><ul>
<li><b>iOS Safari</b>：配对成功后 → 分享按钮 → 「添加到主屏幕」</li>
<li><b>Android Chrome</b>：配对成功后 → 菜单 ⋮ → 「添加到主屏幕 / 安装应用」</li>
</ul></details>
<details><summary>ℹ️ 常见问题</summary><ul>
<li>提示码无效或过期：码 10 分钟后过期，请在 Mac 面板重新生成</li>
<li>本页面可加入书签，登录过期后直接打开输新码即可，无需重装 APP</li>
<li>更快：在 Tailscale 应用开启 Connect on Demand（iOS）/ 常驻 VPN（Android），之后自动连接、打开即进</li>
</ul></details>
</div></body></html>`
}

/**
 * 配对成功页（安装门户）：码兑换成功后的落点。
 * Set-Cookie 由响应头完成，本页负责：一键安装按钮（Chrome/Android 原生安装，
 * iOS 走平台限制内的最简指引）、SW 注册、进入控制台入口。
 */
export function renderPairSuccess() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 已登录本设备</title>
<link rel="manifest" href="/tsctl/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/tsctl/icons/180.png">
<meta name="theme-color" content="#1f2430"><style>
:root{color-scheme:light dark}
body{font-family:-apple-system,'Segoe UI',sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f6f7f9;color:#1a1c1e;margin:0}
@media (prefers-color-scheme: dark){body{background:#16181d;color:#e6e6e6}}
.box{max-width:440px;padding:30px;border:1px solid rgba(127,127,127,.35);border-radius:14px;background:rgba(127,127,127,.06);text-align:center}
h2{margin:0 0 6px;font-size:20px}.ok{color:#3fb950;font-weight:700;font-size:28px;margin:0 0 4px}
p.lead{margin:6px 0 16px;font-size:13px;opacity:.8}
#install-btn{width:100%;padding:13px;border:0;border-radius:10px;background:#2f6feb;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
#enter{display:block;margin-top:12px;padding:11px;border:1px solid rgba(127,127,127,.45);border-radius:10px;color:inherit;text-decoration:none;font-size:15px}
#ios-guide,#fallback-guide{margin-top:14px;text-align:left;font-size:13px;background:rgba(127,127,127,.08);border-radius:10px;padding:12px 14px}
#install-done{margin-top:14px;color:#3fb950;font-weight:600;font-size:14px}
li{margin:6px 0}.sub{font-size:12px;opacity:.7;margin-top:10px}
</style></head><body><div class="box">
<div class="ok">✓</div>
<h2>已登录本设备</h2>
<p class="lead">已装入 tailnet 信任名单：本设备打开 APP 即自动续登（无需再配对）。推荐装成本机 APP：</p>
<button id="install-btn" hidden>⬇ 安装 APP（一键）</button>
<div id="install-done" hidden>✓ 已安装。可在桌面 / 启动台 / 主屏幕打开（独立窗口，非标签页）</div>
<div id="ios-guide" hidden><b>iPhone / iPad（苹果限制，两步）：</b><ol style="padding-left:18px;margin:8px 0 0">
<li>点浏览器底部分享按钮 □↑</li><li>选「添加到主屏幕」→ 确认</li></ol></div>
<div id="fallback-guide" hidden><b>当前浏览器不支持一键安装：</b>
可先继续用网页；或换 Chrome/Edge 打开本页获得一键安装。</div>
<a id="enter" href="/">进入控制台 →</a>
<div class="sub">忘记扫码的设备：打开本页（书签 /tsctl/pair）输 Mac 面板的 8 位码即可。</div>
</div><script>
(function(){
  var deferred=null,btn=document.getElementById('install-btn'),guide=document.getElementById('ios-guide'),fb=document.getElementById('fallback-guide'),done=document.getElementById('install-done')
  var standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true
  var isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)
  try{if('serviceWorker' in navigator)navigator.serviceWorker.register('/tsctl/sw.js',{scope:'/'}).catch(function(){})}catch(e){}
  addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;if(!standalone){btn.hidden=false;guide.hidden=true;fb.hidden=true}})
  if(standalone){location.replace('/');return}
  if(isIOS){guide.hidden=false}else{fb.hidden=false}
  btn.addEventListener('click',function(){if(!deferred)return;deferred.prompt();deferred.userChoice.then(function(r){if(r.outcome==='accepted'){btn.hidden=true;guide.hidden=true;fb.hidden=true;done.hidden=false}deferred=null})})
})()
</script></body></html>`
}
