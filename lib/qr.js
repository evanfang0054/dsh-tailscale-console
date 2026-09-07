// 纯 JS QR 编码器（ISO/IEC 18004 byte 模式最小集）
// 支持 version 1-10、EC level M、自动版本选择与自动掩码（规范罚分）。
// 正确性保障：tests/qr.test.mjs 与成熟库 qrcode-generator 做全矩阵对拍。

// ── GF(256)（多项式 0x11d）────────────────────────────────────────────────────
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

// Reed-Solomon（Nayuki 移位寄存器形式）
function rsDivisor(deg) {
  if (deg < 1 || deg > 255) throw new Error("qr: RS degree out of range")
  const result = new Uint8Array(deg)
  result[deg - 1] = 1
  let root = 1
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      result[j] = gmul(result[j], root)
      if (j + 1 < deg) result[j] ^= result[j + 1]
    }
    root = gmul(root, 2)
  }
  return result
}
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length)
  for (const b of data) {
    const factor = b ^ result[0]
    result.copyWithin(0, 1)
    result[divisor.length - 1] = 0
    for (let i = 0; i < divisor.length; i++) result[i] ^= gmul(divisor[i], factor)
  }
  return result
}

// ── 版本表（EC = M）：data 码字数、每块 EC 码字、分组 [块数, 每块数据码字] ────
const VERSIONS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
}
// 校正图形中心坐标（v1 无）
const ALIGN = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

// ── 数据编码：模式 0100 + 长度 + UTF-8 + 终止符 + 补齐 + pad + 剩余位 ─────────
function buildBitstream(text) {
  const bytes = new TextEncoder().encode(text)
  for (let v = 1; v <= 10; v++) {
    const spec = VERSIONS[v]
    const dataCw = spec.groups.reduce((n, [cnt, len]) => n + cnt * len, 0)
    const lenBits = v <= 9 ? 8 : 16
    const capBits = dataCw * 8
    if (4 + lenBits + bytes.length * 8 > capBits) continue
    const bits = []
    const push = (val, n) => {
      for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1)
    }
    push(0b0100, 4)
    push(bytes.length, lenBits)
    for (const b of bytes) push(b, 8)
    push(0, Math.min(4, capBits - bits.length))
    while (bits.length % 8 !== 0) bits.push(0)
    const pads = [0xec, 0x11]
    let pi = 0
    while (bits.length < capBits) push(pads[pi++ % 2], 8)
    const rem = v >= 2 && v <= 6 ? 7 : 0
    for (let i = 0; i < rem; i++) bits.push(0)
    const dataCws = new Uint8Array(dataCw)
    for (let i = 0; i < dataCw; i++)
      for (let j = 0; j < 8; j++) dataCws[i] = (dataCws[i] << 1) | bits[i * 8 + j]
    return { version: v, spec, dataCws }
  }
  throw new Error("qr: text too long (max ~v10)")
}

// 分块 RS + 数据/EC 码字交错
function interleave(dataCws, spec) {
  const blocks = []
  let off = 0
  for (const [cnt, len] of spec.groups) {
    for (let k = 0; k < cnt; k++) {
      const slice = dataCws.slice(off, off + len)
      blocks.push({ data: slice, ec: rsRemainder(slice, rsDivisor(spec.ec)) })
      off += len
    }
  }
  const out = []
  const maxLen = Math.max(...blocks.map((b) => b.data.length))
  for (let i = 0; i < maxLen; i++)
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i])
  for (let i = 0; i < spec.ec; i++)
    for (const b of blocks) out.push(b.ec[i])
  return Uint8Array.from(out)
}

// ── 格式/版本信息 ─────────────────────────────────────────────────────────────
function formatBits(mask) {
  const data = mask // EC=M → 00
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}
function versionBits(v) {
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (v << 12) | rem
}

// ── 矩阵构建 ──────────────────────────────────────────────────────────────────
function makeBase(version, finalBits) {
  const size = 17 + 4 * version
  const modules = Array.from({ length: size }, () => new Uint8Array(size))
  const reserved = Array.from({ length: size }, () => new Uint8Array(size))
  const set = (r, c, v) => {
    modules[r][c] = v ? 1 : 0
    reserved[r][c] = 1
  }
  // finder + 分隔线
  const drawFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        set(rr, cc, dark)
      }
  }
  drawFinder(0, 0)
  drawFinder(0, size - 7)
  drawFinder(size - 7, 0)
  // timing
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  // 格式信息占位（写 0 并标记保留；最终值在掩码选定后由 drawFormatBits 重写）
  const fmtPlaceholder = formatBits(0)
  for (let i = 0; i <= 5; i++) set(i, 8, (fmtPlaceholder >>> i) & 1)
  set(7, 8, (fmtPlaceholder >>> 6) & 1)
  set(8, 8, (fmtPlaceholder >>> 7) & 1)
  set(8, 7, (fmtPlaceholder >>> 8) & 1)
  for (let i = 9; i < 15; i++) set(8, 14 - i, (fmtPlaceholder >>> i) & 1)
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, (fmtPlaceholder >>> i) & 1)
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, (fmtPlaceholder >>> i) & 1)
  set(size - 8, 8, 1) // 恒暗模块
  // 版本信息（v≥7）
  if (version >= 7) {
    const vb = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(b, a, bit)
      set(a, b, bit)
    }
  }
  // 校正图形（跳过与三个角 finder 重叠的组合）
  const centers = ALIGN[version] ?? []
  const last = centers[centers.length - 1]
  for (let i = 0; i < centers.length; i++)
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) continue
      const cr = centers[i], cc = centers[j]
      for (let r = -2; r <= 2; r++)
        for (let c = -2; c <= 2; c++) set(cr + r, cc + c, Math.max(Math.abs(r), Math.abs(c)) !== 1)
    }
  // 数据之字形布置
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j
        const upward = ((right + 1) & 2) === 0
        const r = upward ? size - 1 - vert : vert
        if (!reserved[r][c] && i < finalBits.length) modules[r][c] = finalBits[i++]
      }
    }
  }
  return { modules, reserved, size }
}

// ── 掩码与罚分 ────────────────────────────────────────────────────────────────
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]
function penalty(m, size) {
  let score = 0
  for (let axis = 0; axis < 2; axis++)
    for (let i = 0; i < size; i++) {
      let run = 1
      let prev = axis === 0 ? m[i][0] : m[0][i]
      for (let j = 1; j < size; j++) {
        const cur = axis === 0 ? m[i][j] : m[j][i]
        if (cur === prev) {
          run++
          if (run === 5) score += 3
          else if (run > 5) score += 1
        } else run = 1
        prev = cur
      }
    }
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]
      if (m[r][c + 1] === v && m[r + 1][c] === v && m[r + 1][c + 1] === v) score += 3
    }
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
  for (let axis = 0; axis < 2; axis++)
    for (let i = 0; i < size; i++)
      for (let j = 0; j <= size - 11; j++) {
        let m1 = true, m2 = true
        for (let k = 0; k < 11; k++) {
          const v = axis === 0 ? m[i][j + k] : m[j + k][i]
          if (v !== p1[k]) m1 = false
          if (v !== p2[k]) m2 = false
        }
        if (m1) score += 40
        if (m2) score += 40
      }
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c]
  score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5)
  return score
}

function drawFormatBits(m, size, mask) {
  const fmt = formatBits(mask)
  const set = (r, c, v) => {
    m[r][c] = v ? 1 : 0
  }
  // 第一份：绕左上 finder（ISO 18004 标准 (行,列) 布局）
  for (let i = 0; i <= 5; i++) set(i, 8, (fmt >>> i) & 1) // 竖条：行0-5, 列8
  set(7, 8, (fmt >>> 6) & 1)
  set(8, 8, (fmt >>> 7) & 1)
  set(8, 7, (fmt >>> 8) & 1)
  for (let i = 9; i < 15; i++) set(8, 14 - i, (fmt >>> i) & 1) // 横条：行8, 列5-0
  // 第二份：分裂到右上横条与左下竖条
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, (fmt >>> i) & 1) // 行8, 列 size-1..size-8
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, (fmt >>> i) & 1) // 行 size-7..size-1, 列8
  set(size - 8, 8, 1) // 恒暗模块
}

// ── 对外 API ──────────────────────────────────────────────────────────────────
export function qrMatrix(text) {
  const { version, spec, dataCws } = buildBitstream(text)
  const finalBytes = interleave(dataCws, spec)
  const finalBits = []
  for (const b of finalBytes) for (let j = 7; j >= 0; j--) finalBits.push((b >>> j) & 1)
  const size = 17 + 4 * version
  const base = makeBase(version, finalBits)
  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = base.modules.map((row) => row.slice())
    const apply = MASKS[mask]
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (!base.reserved[r][c] && apply(r, c)) m[r][c] ^= 1
    drawFormatBits(m, size, mask)
    const p = penalty(m, size)
    if (p < bestScore) {
      bestScore = p
      best = m
    }
  }
  return { version, size, get: (r, c) => best[r][c] }
}

export function qrSvg(text) {
  const { size, get } = qrMatrix(text)
  let d = ""
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) if (get(r, c)) d += `M${c} ${r}h1v1h-1z`
  const total = size + 16
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 ${total} ${total}" shape-rendering="crispEdges"><rect x="-8" y="-8" width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
