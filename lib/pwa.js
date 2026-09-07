// PWA 资源增强纯函数：增强 manifest + index head 注入
// 继承 dsh 原 manifest 字段（见 dsh-web-frontend/dist/manifest.webmanifest）

const BASE = { id: "/", name: "DeepSeek Harness", short_name: "DSH", start_url: "/tsctl/auto-login", scope: "/" }

export function enhancedManifest() {
  return {
    ...BASE,
    display: "standalone",
    theme_color: "#1f2430",
    background_color: "#0f172a",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/tsctl/icons/192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/tsctl/icons/512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  }
}

const TOUCH = '<link rel="apple-touch-icon" sizes="180x180" href="/tsctl/icons/180.png" />'
const MANIFEST_RE = /<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest"\s*\/>/

// 注入 apple-touch-icon 并把 manifest 链接替换为插件增强版；找不到目标时原样返回
export function injectPwaHead(html) {
  if (typeof html !== "string" || !MANIFEST_RE.test(html)) return html
  return html.replace(MANIFEST_RE, TOUCH + '<link rel="manifest" href="/tsctl/manifest.webmanifest" />')
}

// 一键安装引导脚本：注册透传 SW（scope /，配合 /tsctl/sw.js 的 Service-Worker-Allowed 头）
// 并捕获 beforeinstallprompt 到 window.__dshPwaInstall，供面板「安装桌面 APP」按钮使用。
const BOOTSTRAP_RE = /__dshPwaInstall/
const BOOTSTRAP = `<script>window.__dshPwaInstall={deferred:null};try{if('serviceWorker' in navigator)navigator.serviceWorker.register('/tsctl/sw.js', { scope: '/' }).catch(function(){})}catch(e){};addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__dshPwaInstall.deferred=e})</script>`

export function injectInstallBootstrap(html) {
  if (typeof html !== "string" || BOOTSTRAP_RE.test(html) || !html.includes("</head>")) return html
  return html.replace("</head>", BOOTSTRAP + "</head>")
}
