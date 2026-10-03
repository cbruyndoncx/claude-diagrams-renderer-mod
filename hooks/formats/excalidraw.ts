// Obsidian Excalidraw drawing (.excalidraw.md or .excalidraw) → standalone SVG, no scripts.
// Clean strokes; the hand-drawn (rough) style is deliberately not reproduced.
import { esc } from '../common'
import { decompressFromBase64 } from './lzstring'

type Point = [number, number]

type Element = {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  angle?: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  strokeStyle?: 'solid' | 'dashed' | 'dotted'
  opacity?: number
  roundness?: { type: number } | null
  points?: Point[]
  startArrowhead?: string | null
  endArrowhead?: string | null
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  fileId?: string | null
  name?: string | null
  isDeleted?: boolean
}

export type ExcalidrawRender = { svg: string; elements: number; skipped: string[]; format: string }

const SANS = 'system-ui, -apple-system, Segoe UI, sans-serif'
const MONO = 'Cascadia Code, Consolas, ui-monospace, monospace'

/** Pull the scene JSON and the embedded-file names out of the drawing note. */
export function extractScene(source: string): { json: string; format: string; files: Map<string, string> } {
  const files = new Map<string, string>()
  const embedded = /^#{1,2} Embedded Files\s*\n([\s\S]*?)(?=^#{1,2} |^%%|$(?![\s\S]))/m.exec(source)
  for (const m of (embedded?.[1] ?? '').matchAll(/^([0-9a-fA-F]{8,}):\s*\[\[([^\]|]+)/gm)) {
    if (m[1] && m[2]) files.set(m[1], m[2])
  }
  const trimmed = source.trimStart()
  if (trimmed.startsWith('{')) return { json: trimmed, format: 'json', files }
  const block = /^#{1,2} Drawing\s*\n```(json|compressed-json)\s*\n([\s\S]*?)\n```/m.exec(source)
  if (!block || !block[1] || block[2] === undefined) throw new Error('no "## Drawing" block found')
  if (block[1] === 'json') return { json: block[2], format: 'json', files }
  const json = decompressFromBase64(block[2])
  if (!json) throw new Error('the compressed drawing could not be decompressed')
  return { json, format: 'compressed-json', files }
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function paint(color: string | undefined, fallback: string): string {
  if (!color || color === 'transparent') return fallback
  return /^#[0-9a-fA-F]{3,8}$|^[a-z]+$|^rgba?\([\d.,\s%]+\)$/.test(color) ? color : fallback
}

function strokeAttrs(el: Element): string {
  const width = num(el.strokeWidth, 1)
  const dash = el.strokeStyle === 'dashed' ? ` stroke-dasharray="${width * 4} ${width * 3}"`
    : el.strokeStyle === 'dotted' ? ` stroke-dasharray="${width} ${width * 2.5}" stroke-linecap="round"` : ''
  return `stroke="${paint(el.strokeColor, '#1e1e1e')}" stroke-width="${width}"${dash}`
}

function fillAttrs(el: Element): string {
  const fill = paint(el.backgroundColor, 'none')
  if (fill === 'none') return 'fill="none"'
  // Hatched fills read lighter than solid ones; approximate with opacity.
  return el.fillStyle === 'solid' ? `fill="${fill}"` : `fill="${fill}" fill-opacity="0.45"`
}

function wrap(el: Element, body: string): string {
  const parts: string[] = []
  const angle = num(el.angle)
  if (angle) {
    const cx = el.x + el.width / 2
    const cy = el.y + el.height / 2
    parts.push(`transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})"`)
  }
  const opacity = num(el.opacity, 100)
  if (opacity < 100) parts.push(`opacity="${opacity / 100}"`)
  return parts.length ? `<g ${parts.join(' ')}>${body}</g>` : body
}

function linePoints(el: Element): Point[] {
  const pts = Array.isArray(el.points) ? el.points : []
  return pts.filter(p => Array.isArray(p) && p.length >= 2).map(([px, py]) => [el.x + num(px), el.y + num(py)])
}

function boundsOf(el: Element): [number, number, number, number] {
  if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
    const pts = linePoints(el)
    if (pts.length) {
      const xs = pts.map(p => p[0])
      const ys = pts.map(p => p[1])
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    }
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height]
}

function drawText(el: Element): string {
  const size = num(el.fontSize, 20)
  const step = size * num(el.lineHeight, 1.25)
  const lines = String(el.text ?? '').replace(/\r/g, '').split('\n')
  const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start'
  const x = el.textAlign === 'center' ? el.x + el.width / 2 : el.textAlign === 'right' ? el.x + el.width : el.x
  const family = el.fontFamily === 3 || el.fontFamily === 8 ? MONO : SANS
  const first = el.y + size * 0.95
  const tspans = lines
    .map((line, i) => `<tspan x="${x}" y="${first + i * step}">${esc(line) || ' '}</tspan>`)
    .join('')
  return `<text font-family="${family}" font-size="${size}" fill="${paint(el.strokeColor, '#1e1e1e')}" text-anchor="${anchor}">${tspans}</text>`
}

const LINEAR = new Set(['line', 'arrow', 'freedraw'])

function median(values: number[]): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Swap the layout's axes — a wide swimlane becomes a tall one — while text stays
 * horizontal. Positions are swapped and rescaled by the typical box aspect ratio
 * (new x = old y · w/h, new y = old x · h/w), so a box keeps its size and an arrow that
 * met its right edge now meets its bottom edge. Long containers (lanes, separators,
 * frames) swap their width and height with the layout, so rows become columns.
 */
export function transposeScene(elements: Element[], swap = false): Element[] {
  // `swap` is the exact axis swap (every shape's width and height swap too): the fallback
  // when keeping shape sizes does not turn the drawing to the other orientation.
  // Typical box size, from ordinary shapes only: lanes and separators would skew it.
  const boxes = elements.filter(e =>
    (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') &&
    e.width > 0 && e.height > 0 && e.width <= 3 * e.height && e.height <= 3 * e.width)
  const mw = median(boxes.map(b => b.width))
  const mh = median(boxes.map(b => b.height))
  const sx = !swap && mw && mh ? mw / mh : 1
  const sy = !swap && mw && mh ? mh / mw : 1
  const map = (x: number, y: number): Point => [y * sx, x * sy]
  const isLong = (e: Element) =>
    (swap && e.type !== 'text') ||
    e.type === 'frame' || e.type === 'magicframe' ||
    (e.type !== 'text' && ((e.width > 3 * e.height && e.width > 3 * mw) || (e.height > 3 * e.width && e.height > 3 * mh)))

  return elements.map(e => {
    if (LINEAR.has(e.type)) {
      const pts = linePoints(e).map(([x, y]) => map(x, y))
      const [x0, y0] = pts[0] ?? map(e.x, e.y)
      const rel = pts.map(([x, y]): Point => [x - x0, y - y0])
      const xs = rel.map(p => p[0])
      const ys = rel.map(p => p[1])
      const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
      const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
      return { ...e, x: x0, y: y0, width, height, points: rel }
    }
    const [cx, cy] = map(e.x + e.width / 2, e.y + e.height / 2)
    const [width, height] = isLong(e) ? [e.height * sx, e.width * sy] : [e.width, e.height]
    return { ...e, x: cx - width / 2, y: cy - height / 2, width, height }
  })
}

export function excalidrawToSvg(source: string, options: { transpose?: boolean | 'swap' } = {}): ExcalidrawRender {
  const scene = extractScene(source)
  const data = JSON.parse(scene.json) as { elements?: unknown; appState?: { viewBackgroundColor?: string } }
  const parsed = (Array.isArray(data.elements) ? data.elements : [])
    .filter((e): e is Element => !!e && typeof e === 'object' && typeof (e as Element).type === 'string')
    .filter(e => !e.isDeleted)
    .map(e => ({ ...e, x: num(e.x), y: num(e.y), width: num(e.width), height: num(e.height) }))
  const all = options.transpose ? transposeScene(parsed, options.transpose === 'swap') : parsed
  const background = paint(data.appState?.viewBackgroundColor, '#ffffff')
  const skipped: string[] = []

  if (all.length === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">` +
        `<rect width="320" height="80" fill="${background}"/>` +
        `<text x="160" y="45" text-anchor="middle" font-family="${SANS}" font-size="14" fill="#59636e">Empty drawing</text></svg>`,
      elements: 0,
      skipped,
      format: scene.format,
    }
  }

  const markers = new Map<string, string>()
  const markerFor = (color: string): string => {
    if (!markers.has(color)) markers.set(color, `h${markers.size}`)
    return markers.get(color) as string
  }

  const body: string[] = []
  for (const el of all) {
    const stroke = strokeAttrs(el)
    switch (el.type) {
      case 'rectangle': {
        const rx = el.roundness ? Math.min(32, Math.min(el.width, el.height) * 0.25) : 0
        body.push(wrap(el, `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" ${fillAttrs(el)} ${stroke}/>`))
        break
      }
      case 'ellipse':
        body.push(wrap(el, `<ellipse cx="${el.x + el.width / 2}" cy="${el.y + el.height / 2}" rx="${el.width / 2}" ry="${el.height / 2}" ${fillAttrs(el)} ${stroke}/>`))
        break
      case 'diamond': {
        const cx = el.x + el.width / 2
        const cy = el.y + el.height / 2
        const pts = `${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}`
        body.push(wrap(el, `<polygon points="${pts}" ${fillAttrs(el)} ${stroke}/>`))
        break
      }
      case 'line':
      case 'arrow': {
        const pts = linePoints(el)
        if (pts.length < 2) break
        const color = paint(el.strokeColor, '#1e1e1e')
        const isArrow = el.type === 'arrow'
        const end = isArrow && (el.endArrowhead ?? 'arrow') ? ` marker-end="url(#${markerFor(color)})"` : ''
        const start = el.startArrowhead ? ` marker-start="url(#${markerFor(color)})"` : ''
        const d = `M${pts.map(p => p.join(',')).join(' L')}`
        const fill = el.type === 'line' && pts.length > 2 && fillAttrs(el) !== 'fill="none"' ? fillAttrs(el) : 'fill="none"'
        body.push(wrap(el, `<path d="${d}" ${fill} ${stroke} stroke-linejoin="round"${start}${end}/>`))
        break
      }
      case 'freedraw': {
        const pts = linePoints(el)
        if (pts.length < 2) break
        body.push(wrap(el, `<path d="M${pts.map(p => p.join(',')).join(' L')}" fill="none" ${stroke} stroke-linecap="round" stroke-linejoin="round"/>`))
        break
      }
      case 'text':
        body.push(wrap(el, drawText(el)))
        break
      case 'frame':
      case 'magicframe':
        body.push(
          `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="8" fill="none" stroke="#868e96" stroke-width="1.5"/>` +
            `<text x="${el.x}" y="${el.y - 6}" font-family="${SANS}" font-size="14" fill="#495057">${esc(el.name ?? 'Frame')}</text>`,
        )
        break
      case 'image':
      case 'embeddable':
      case 'iframe': {
        const label = (el.fileId && scene.files.get(el.fileId)) || el.type
        skipped.push(label)
        body.push(wrap(el,
          `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="#f1f3f5" stroke="#adb5bd" stroke-dasharray="6 4"/>` +
            `<text x="${el.x + el.width / 2}" y="${el.y + el.height / 2}" text-anchor="middle" font-family="${SANS}" font-size="14" fill="#495057">${esc(label)}</text>`))
        break
      }
      default:
        skipped.push(el.type)
    }
  }

  const boxes = all.map(boundsOf)
  const pad = 30
  const minX = Math.min(...boxes.map(b => b[0])) - pad
  const minY = Math.min(...boxes.map(b => b[1])) - pad - 10
  const width = Math.round(Math.max(...boxes.map(b => b[2])) + pad - minX)
  const height = Math.round(Math.max(...boxes.map(b => b[3])) + pad - minY)

  const defs = [...markers.entries()]
    .map(([color, id]) =>
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10" fill="none" stroke="${color}" stroke-width="1.6"/></marker>`)
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">` +
    `<defs>${defs}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${background}"/>` +
    body.join('') +
    `</svg>`
  return { svg, elements: all.length, skipped, format: scene.format }
}
