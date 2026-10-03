// JSON Canvas (https://jsoncanvas.org) → standalone SVG, no scripts.
import { CHAR_WIDTH, esc, wrapLines } from '../common'

type Side = 'top' | 'right' | 'bottom' | 'left'

type CanvasNode = {
  id: string
  type: 'text' | 'file' | 'link' | 'group' | string
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
}

type CanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  fromSide?: Side
  toSide?: Side
  fromEnd?: 'none' | 'arrow'
  toEnd?: 'none' | 'arrow'
  color?: string
  label?: string
}

export type CanvasRender = { svg: string; nodes: number; edges: number }

/** Obsidian's six canvas colour presets. */
const PRESETS: Record<string, string> = {
  '1': '#e93147',
  '2': '#ec7500',
  '3': '#e0ac00',
  '4': '#08b94e',
  '5': '#00bfbc',
  '6': '#7852ee',
}
const INK = '#1f2328'
const MUTED = '#59636e'
const LINE = '#8c959f'
const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'

function colorOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (PRESETS[value]) return PRESETS[value]
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : undefined
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function anchor(node: CanvasNode, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    case 'right':
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

/** When an edge names no side, take the pair of sides facing each other. */
function facingSides(a: CanvasNode, b: CanvasNode): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2)
  const dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

function normal(side: Side): { x: number; y: number } {
  return { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[side]
}

function textBlock(lines: string[], x: number, y: number, size: number, color: string, weight = 400): string {
  const step = Math.round(size * 1.35)
  return lines
    .map((line, i) =>
      `<text x="${x}" y="${y + size + i * step}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(line)}</text>`)
    .join('')
}

function fitLines(text: string, width: number, height: number, size: number): string[] {
  const perLine = (width - 24) / (size * CHAR_WIDTH)
  const room = Math.max(1, Math.floor((height - 16) / (size * 1.35)))
  const lines = wrapLines(text, perLine)
  if (lines.length <= room) return lines
  const kept = lines.slice(0, room)
  kept[room - 1] = `${(kept[room - 1] ?? '').slice(0, Math.max(0, Math.floor(perLine) - 1))}…`
  return kept
}

function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.replace(/\.md$/i, '')
}

function median(values: number[]): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const SWAPPED_SIDE: Record<Side, Side> = { left: 'top', top: 'left', right: 'bottom', bottom: 'right' }

/**
 * Swap the layout's axes (landscape ↔ portrait). Positions swap and are rescaled by the
 * typical card's aspect ratio (new x = old y · w/h, new y = old x · h/w) so cards keep
 * their size and text; groups map corner to corner, so a wide group becomes a tall one;
 * an edge's named sides swap with the axes (left ↔ top, right ↔ bottom).
 */
export function transposeCanvas(nodes: CanvasNode[], edges: CanvasEdge[], swap = false): [CanvasNode[], CanvasEdge[]] {
  // `swap` is the exact axis swap (every card's width and height swap too): the fallback
  // when keeping card sizes leaves very wide cards still wider than the layout is tall.
  const cards = nodes.filter(n => n.type !== 'group' && n.width <= 3 * n.height && n.height <= 3 * n.width)
  const mw = median(cards.map(n => n.width))
  const mh = median(cards.map(n => n.height))
  const sx = !swap && mw && mh ? mw / mh : 1
  const sy = !swap && mw && mh ? mh / mw : 1
  const mapped = nodes.map(n => {
    const cx = (n.y + n.height / 2) * sx
    const cy = (n.x + n.width / 2) * sy
    const [width, height] = swap || n.type === 'group' ? [n.height * sx, n.width * sy] : [n.width, n.height]
    return { ...n, x: cx - width / 2, y: cy - height / 2, width, height }
  })
  const swapped = edges.map(e => ({
    ...e,
    fromSide: e.fromSide && SWAPPED_SIDE[e.fromSide],
    toSide: e.toSide && SWAPPED_SIDE[e.toSide],
  }))
  return [mapped, swapped]
}

export function canvasToSvg(source: string, options: { transpose?: boolean | 'swap' } = {}): CanvasRender {
  const data = JSON.parse(source) as { nodes?: unknown; edges?: unknown }
  const parsedNodes = (Array.isArray(data.nodes) ? data.nodes : [])
    .filter((n): n is CanvasNode => !!n && typeof n === 'object' && typeof (n as CanvasNode).id === 'string')
    .map(n => ({ ...n, x: num(n.x), y: num(n.y), width: num(n.width, 250), height: num(n.height, 60) }))
  const parsedEdges = (Array.isArray(data.edges) ? data.edges : [])
    .filter((e): e is CanvasEdge => !!e && typeof e === 'object' && typeof (e as CanvasEdge).fromNode === 'string')
  const [nodes, edges] = options.transpose
    ? transposeCanvas(parsedNodes, parsedEdges, options.transpose === 'swap')
    : [parsedNodes, parsedEdges]
  const byId = new Map(nodes.map(n => [n.id, n]))

  if (nodes.length === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">` +
        `<rect width="320" height="80" rx="8" fill="#ffffff"/>` +
        `<text x="160" y="45" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${MUTED}">Empty canvas</text></svg>`,
      nodes: 0,
      edges: 0,
    }
  }

  const pad = 40
  const minX = Math.min(...nodes.map(n => n.x)) - pad
  const minY = Math.min(...nodes.map(n => n.y)) - pad - 24 // room for group labels
  const maxX = Math.max(...nodes.map(n => n.x + n.width)) + pad
  const maxY = Math.max(...nodes.map(n => n.y + n.height)) + pad
  const width = Math.round(maxX - minX)
  const height = Math.round(maxY - minY)

  const parts: string[] = []
  const markers = new Map<string, string>()
  const markerFor = (color: string): string => {
    const id = `a${markers.size}`
    if (!markers.has(color)) {
      markers.set(color, id)
    }
    return markers.get(color) as string
  }

  // Groups first so everything else paints over them.
  for (const n of nodes.filter(n => n.type === 'group')) {
    const color = colorOf(n.color) ?? LINE
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" ` +
        `fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-width="2"/>`,
    )
    if (n.label) parts.push(textBlock([n.label], n.x + 4, n.y - 26, 16, INK, 600))
  }

  // Edges under the cards they connect.
  for (const e of edges) {
    const from = byId.get(e.fromNode)
    const to = byId.get(e.toNode)
    if (!from || !to) continue
    const [autoFrom, autoTo] = facingSides(from, to)
    const fromSide = e.fromSide ?? autoFrom
    const toSide = e.toSide ?? autoTo
    const a = anchor(from, fromSide)
    const b = anchor(to, toSide)
    const reach = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 3)
    const na = normal(fromSide)
    const nb = normal(toSide)
    const color = colorOf(e.color) ?? LINE
    const marker = markerFor(color)
    const startArrow = e.fromEnd === 'arrow' ? ` marker-start="url(#${marker})"` : ''
    const endArrow = (e.toEnd ?? 'arrow') === 'arrow' ? ` marker-end="url(#${marker})"` : ''
    parts.push(
      `<path d="M${a.x},${a.y} C${a.x + na.x * reach},${a.y + na.y * reach} ` +
        `${b.x + nb.x * reach},${b.y + nb.y * reach} ${b.x},${b.y}" fill="none" ` +
        `stroke="${color}" stroke-width="2.5"${startArrow}${endArrow}/>`,
    )
    if (e.label) {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const w = e.label.length * 14 * CHAR_WIDTH + 16
      parts.push(
        `<rect x="${mx - w / 2}" y="${my - 13}" width="${w}" height="26" rx="6" fill="#ffffff" stroke="${color}"/>` +
          `<text x="${mx}" y="${my + 5}" text-anchor="middle" font-size="14" fill="${INK}">${esc(e.label)}</text>`,
      )
    }
  }

  // Cards.
  for (const n of nodes.filter(n => n.type !== 'group')) {
    const color = colorOf(n.color)
    const stroke = color ?? '#d0d7de'
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="2"/>`,
    )
    if (color) {
      parts.push(
        `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${color}" fill-opacity="0.08"/>`,
      )
    }
    const x = n.x + 12
    const y = n.y + 8
    if (n.type === 'file' && n.file) {
      const title = baseName(n.file) + (n.subpath ?? '')
      parts.push(textBlock(fitLines(title, n.width, n.height - 22, 18), x, y, 18, INK, 600))
      parts.push(textBlock(fitLines(n.file, n.width, 30, 12), x, n.y + n.height - 28, 12, MUTED))
    } else if (n.type === 'link' && n.url) {
      parts.push(textBlock(fitLines(n.url, n.width, n.height, 15), x, y, 15, '#0969da'))
    } else {
      parts.push(textBlock(fitLines(n.text ?? n.label ?? '', n.width, n.height, 15), x, y, 15, INK))
    }
  }

  const defs = [...markers.entries()]
    .map(([color, id]) =>
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker>`)
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${minX} ${minY} ${width} ${height}" font-family="${FONT}">` +
    `<defs>${defs}</defs>` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f6f8fa"/>` +
    parts.join('') +
    `</svg>`
  return { svg, nodes: nodes.length, edges: edges.length }
}
