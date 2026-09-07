// 用法：node scripts/gen-icons.mjs [favicon.svg 路径]
// 提取 dsh 图标的 path 数据，自绘「深色底 + 白色 logo」应用图标，Chrome headless
// 栅格化为 180/192/512 PNG，重写 lib/icons.js。dsh 换图标后重跑本脚本即可。
// 注意：每尺寸用独立 HTML + 显式像素定位（不用 vmin/flex，规避 headless 视口歧义），
// 并固定 --force-device-scale-factor=1。
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const svgPath =
  process.argv[2] ??
  join(process.env.HOME, ".nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg")
const chrome = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sizes = [180, 192, 512]

// 提取主 path 的 d 数据（dsh favicon 为单 path + fill:none + 深色媒体查询，直接引用会不可控）
const svg = readFileSync(svgPath, "utf8")
const d = svg.match(/<path[^>]*\bd="([^"]+)"/)?.[1]
if (!d) throw new Error("未能在 SVG 中找到 path d 数据: " + svgPath)

// 应用图标形态：深色底块 + 居中白色 logo（占 62%，满足 maskable 安全区）
const TILE_BG = "#16181d"
const GLYPH = "#ffffff"
const dir = mkdtempSync(join(tmpdir(), "dsh-icons-"))

const out = {}
for (const s of sizes) {
  const glyph = Math.round(s * 0.62)
  const off = Math.round((s - glyph) / 2)
  const html = join(dir, `icon-${s}.html`)
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;overflow:hidden;background:${TILE_BG}}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" fill="${GLYPH}" ` +
      `style="position:absolute;left:${off}px;top:${off}px;width:${glyph}px;height:${glyph}px">` +
      `<path d="${d}"/></svg>`,
  )
  const png = join(dir, `${s}.png`)
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--force-device-scale-factor=1",
      `--screenshot=${png}`,
      `--window-size=${s},${s}`,
      `file://${html}`,
    ],
    { stdio: "ignore" },
  )
  const buf = readFileSync(png)
  const sigOk = buf[0] === 0x89 && buf[1] === 0x50 && buf.readUInt32BE(16) === s && buf.readUInt32BE(20) === s
  if (!sigOk) throw new Error(`${s}.png 生成异常（签名/尺寸不符）`)
  out[s] = buf.toString("base64")
  console.log(`✓ ${s}x${s} (${Math.round(buf.length / 1024)}KB)`)
}

const target = join(process.cwd(), "lib/icons.js")
writeFileSync(
  target,
  `// 由 scripts/gen-icons.mjs 生成：应用图标（深色底 + dsh 白色 logo，PNG base64）。换图标后重跑本脚本。\nexport const ICON_SIZES = ${JSON.stringify(sizes)}\nconst ICON_B64 = ${JSON.stringify(out, null, 2)}\nexport function iconPng(size) {\n  const b64 = ICON_B64[size]\n  return b64 === undefined ? undefined : Buffer.from(b64, "base64")\n}\n`,
)
console.log("written:", target)
