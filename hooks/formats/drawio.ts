// draw.io / diagrams.net (.drawio, mxGraphModel XML) → standalone SVG, no scripts.
// The built-in renderer, used when the draw.io command-line export is unavailable or
// the person asked for the other orientation (an export is a fixed picture).
import { CHAR_WIDTH, esc, wrapLines } from '../common'
import { decodeEntities, parseXml } from '../xml'
import type { XmlNode } from '../xml'

export type DrawioPage = { index: number; name: string; id: string; compressed: boolean; content: string; model?: XmlNode }
export type DrawioRender = { svg: string; vertices: number; edges: number; page: string }

function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c
    const deeper = find(c, name)
    if (deeper) return deeper
  }
  return undefined
}

// ── pages ────────────────────────────────────────────────────────────────

export function listPages(source: string): DrawioPage[] {
  const doc = parseXml(source)
  const file = find(doc, 'mxfile')
  if (!file) {
    const model = find(doc, 'mxGraphModel')
    if (!model) throw new Error('not a draw.io file (no <mxfile> or <mxGraphModel>)')
    return [{ index: 0, name: 'Page-1', id: 'page-1', compressed: false, content: '', model }]
  }
  return file.children
    .filter(d => d.name === 'diagram')
    .map((d, index) => {
      const model = find(d, 'mxGraphModel')
      return {
        index,
        name: d.attrs.name ?? `Page-${index + 1}`,
        id: d.attrs.id ?? `page-${index + 1}`,
        compressed: !model && d.text.trim().length > 0,
        content: model ? '' : d.text.trim(),
        model,
      }
    })
}

/** A compressed page holds base64 of raw-deflated, URI-encoded XML. */
export async function inflatePage(page: DrawioPage): Promise<DrawioPage> {
  if (!page.compressed) return page
  const Stream = (globalThis as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> })
    .DecompressionStream
  if (!Stream) throw new Error('this page is stored compressed and this environment cannot inflate it')
  const bytes = Uint8Array.from(atob(page.content.replace(/\s+/g, '')), c => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'))
  const xml = decodeURIComponent(await new Response(stream).text())
  const model = find(parseXml(xml), 'mxGraphModel')
  if (!model) throw new Error('the compressed page did not contain a diagram')
  return { ...page, compressed: false, model }
}

// ── styles and labels ─────────────────────────────────────────────────────

type Style = Record<string, string> & { shape: string }

function parseStyle(style: string | undefined): Style {
  const out: Record<string, string> = {}
  let shape = 'rect'
  for (const part of (style ?? '').split(';')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq < 0) shape = part
    else out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return { ...out, shape: out.shape ?? shape }
}

function color(value: string | undefined, fallback: string): string {
  if (!value || value === 'default') return fallback
  if (value === 'none') return 'none'
  return /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgba?\([\d.,\s%]+\)$/.test(value) ? value : fallback
}

/** draw.io labels are often HTML: keep the line structure, drop the markup. */
export function labelText(value: string | undefined, isHtml: boolean): string {
  if (!value) return ''
  if (!isHtml) return value
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── geometry ──────────────────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }
type Cell = {
  id: string
  parent?: string
  value: string
  style: Style
  vertex: boolean
  edge: boolean
  source?: string
  target?: string
  geo?: XmlNode
}

function n(value: string | undefined, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function median(values: number[]): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function collectCells(model: XmlNode): Cell[] {
  const root = model.children.find(c => c.name === 'root') ?? model
  const cells: Cell[] = []
  for (const node of root.children) {
    // <object>/<UserObject> wrap an mxCell and carry the label and id.
    const wrapper = node.name === 'object' || node.name === 'UserObject' ? node : undefined
    const cell = wrapper ? wrapper.children.find(c => c.name === 'mxCell') : node.name === 'mxCell' ? node : undefined
    if (!cell) continue
    cells.push({
      id: wrapper?.attrs.id ?? cell.attrs.id ?? '',
      parent: cell.attrs.parent,
      value: wrapper?.attrs.label ?? cell.attrs.value ?? '',
      style: parseStyle(cell.attrs.style),
      vertex: cell.attrs.vertex === '1',
      edge: cell.attrs.edge === '1',
      source: cell.attrs.source,
      target: cell.attrs.target,
      geo: cell.children.find(c => c.name === 'mxGeometry'),
    })
  }
  return cells
}

function clipToBox(box: Box, toward: Point): Point {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const s = Math.min(box.w / 2 / Math.abs(dx || 1e-9), box.h / 2 / Math.abs(dy || 1e-9))
  return { x: cx + dx * s, y: cy + dy * s }
}

// ── drawing ───────────────────────────────────────────────────────────────

function textLines(lines: string[], box: Box, st: Style, defaultColor: string): string {
  const size = n(st.fontSize, 12)
  const step = size * 1.25
  const align = st.align ?? 'center'
  const valign = st.verticalAlign ?? 'middle'
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const pad = 4
  const x = align === 'left' ? box.x + pad + n(st.spacingLeft) : align === 'right' ? box.x + box.w - pad : box.x + box.w / 2
  const total = lines.length * step
  const top = valign === 'top' ? box.y + pad + n(st.spacingTop) : valign === 'bottom' ? box.y + box.h - total - pad : box.y + (box.h - total) / 2
  const fontStyle = n(st.fontStyle)
  const weight = fontStyle & 1 ? ' font-weight="700"' : ''
  const italic = fontStyle & 2 ? ' font-style="italic"' : ''
  const underline = fontStyle & 4 ? ' text-decoration="underline"' : ''
  const tspans = lines
    .map((line, i) => `<tspan x="${x}" y="${top + size * 0.95 + i * step}">${esc(line) || ' '}</tspan>`)
    .join('')
  return `<text font-size="${size}" fill="${color(st.fontColor, defaultColor)}" text-anchor="${anchor}"${weight}${italic}${underline}>${tspans}</text>`
}

/** Wrap a label to its box; `force` wraps even unwrapped labels (their box was turned). */
function wrapLabel(text: string, box: Box, st: Style, force = false): string[] {
  const size = n(st.fontSize, 12)
  if (st.whiteSpace !== 'wrap' && !force) return text.split('\n')
  return wrapLines(text, (box.w - 8) / (size * CHAR_WIDTH))
}

export function pageToSvg(page: DrawioPage, options: { transpose?: boolean | 'swap' } = {}): DrawioRender {
  if (!page.model) throw new Error(`page "${page.name}" is compressed; inflate it first`)
  const cells = collectCells(page.model)
  const byId = new Map(cells.map(c => [c.id, c]))
  const background = color(page.model.attrs.background, '#ffffff')
  const dark = /^#[0-3][0-9a-fA-F]/.test(background) || background === 'black'
  const defaultInk = dark ? '#f0f0f0' : '#1f2328'
  const defaultStroke = dark ? '#c0c0c0' : '#1f2328'

  // Absolute boxes as drawn in the file: geometry is relative to a vertex parent.
  const rawBoxes = new Map<string, Box>()
  const rawBoxOf = (cell: Cell, depth = 0): Box | undefined => {
    if (rawBoxes.has(cell.id)) return rawBoxes.get(cell.id)
    if (!cell.vertex || !cell.geo || depth > 50) return undefined
    const g = cell.geo.attrs
    let box: Box = { x: n(g.x), y: n(g.y), w: n(g.width), h: n(g.height) }
    const parent = cell.parent ? byId.get(cell.parent) : undefined
    if (parent?.vertex) {
      const pb = rawBoxOf(parent, depth + 1)
      if (pb) box = { ...box, x: box.x + pb.x, y: box.y + pb.y }
    }
    rawBoxes.set(cell.id, box)
    return box
  }

  // Transposed (landscape ↔ portrait): swap axes, rescaled by the typical shape's aspect
  // ratio, so ordinary shapes keep their size and label; containers map corner to corner.
  const hasChildren = new Set(cells.filter(c => c.parent).map(c => c.parent as string))
  const shapeBoxes = cells.filter(c => c.vertex && c.style.shape !== 'text').map(c => rawBoxOf(c)).filter((b): b is Box => !!b)
  const ordinary = shapeBoxes.filter(b => b.w > 0 && b.h > 0 && b.w <= 3 * b.h && b.h <= 3 * b.w)
  const mw = median(ordinary.map(b => b.w))
  const mh = median(ordinary.map(b => b.h))
  // `swap` is the exact axis swap (every shape's width and height swap too): the fallback
  // when keeping shape sizes does not turn the page to the other orientation.
  const swap = options.transpose === 'swap'
  const sx = options.transpose === true && mw && mh ? mw / mh : 1
  const sy = options.transpose === true && mw && mh ? mh / mw : 1
  const mapPoint = (p: Point): Point => (options.transpose ? { x: p.y * sx, y: p.x * sy } : p)
  const isContainer = (cell: Cell, b: Box) =>
    swap ||
    cell.style.shape === 'swimlane' || hasChildren.has(cell.id) ||
    (cell.style.shape !== 'text' && ((b.w > 3 * b.h && b.w > 3 * mw) || (b.h > 3 * b.w && b.h > 3 * mh)))
  const boxes = new Map<string, Box>()
  const boxOf = (cell: Cell): Box | undefined => {
    if (boxes.has(cell.id)) return boxes.get(cell.id)
    const raw = rawBoxOf(cell)
    if (!raw) return undefined
    let box = raw
    if (options.transpose) {
      const c = mapPoint({ x: raw.x + raw.w / 2, y: raw.y + raw.h / 2 })
      const [w, h] = isContainer(cell, raw) ? [raw.h * sx, raw.w * sy] : [raw.w, raw.h]
      box = { x: c.x - w / 2, y: c.y - h / 2, w, h }
    }
    boxes.set(cell.id, box)
    return box
  }

  const markers = new Map<string, string>()
  const markerFor = (c: string): string => {
    if (!markers.has(c)) markers.set(c, `m${markers.size}`)
    return markers.get(c) as string
  }

  const shapeParts: string[] = []
  const lineParts: string[] = []
  const labels: string[] = []
  const extents: Box[] = []
  let vertices = 0
  let edges = 0

  const edgePath = (cell: Cell): Point[] | undefined => {
    const geo = cell.geo
    const waypoints = (geo?.children.find(c => c.name === 'Array' && c.attrs.as === 'points')?.children ?? [])
      .filter(p => p.name === 'mxPoint')
      .map(p => mapPoint({ x: n(p.attrs.x), y: n(p.attrs.y) }))
    const point = (as: string) => {
      const p = geo?.children.find(c => c.name === 'mxPoint' && c.attrs.as === as)
      return p ? mapPoint({ x: n(p.attrs.x), y: n(p.attrs.y) }) : undefined
    }
    const src = cell.source ? byId.get(cell.source) : undefined
    const tgt = cell.target ? byId.get(cell.target) : undefined
    const sb = src ? boxOf(src) : undefined
    const tb = tgt ? boxOf(tgt) : undefined
    const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
    const firstAim = waypoints[0] ?? (tb ? centre(tb) : point('targetPoint'))
    const lastAim = waypoints[waypoints.length - 1] ?? (sb ? centre(sb) : point('sourcePoint'))
    const start = sb && firstAim ? clipToBox(sb, firstAim) : point('sourcePoint')
    const end = tb && lastAim ? clipToBox(tb, lastAim) : point('targetPoint')
    if (!start || !end) return undefined
    return [start, ...waypoints, end]
  }

  for (const cell of cells) {
    const st = cell.style
    const isHtml = st.html === '1'
    if (cell.edge) {
      const path = edgePath(cell)
      if (!path) continue
      edges++
      const stroke = color(st.strokeColor, defaultStroke)
      if (stroke === 'none') continue
      const width = n(st.strokeWidth, 1)
      const dash = st.dashed === '1' ? ` stroke-dasharray="${width * 4} ${width * 3}"` : ''
      const end = (st.endArrow ?? 'classic') !== 'none' ? ` marker-end="url(#${markerFor(stroke)})"` : ''
      const start = st.startArrow && st.startArrow !== 'none' ? ` marker-start="url(#${markerFor(stroke)})"` : ''
      const opacity = st.opacity ? ` opacity="${n(st.opacity, 100) / 100}"` : ''
      lineParts.push(`<path d="M${path.map(p => `${p.x},${p.y}`).join(' L')}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash}${start}${end}${opacity}/>`)
      path.forEach(p => extents.push({ x: p.x, y: p.y, w: 0, h: 0 }))
      const text = labelText(cell.value, isHtml)
      if (text) {
        const mid = path[Math.floor(path.length / 2) - (path.length % 2 === 0 ? 1 : 0)] as Point
        const next = path[path.indexOf(mid) + 1] ?? mid
        const at = { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 }
        const size = n(st.fontSize, 11)
        const textArr = text.split('\n')
        const w = Math.max(...textArr.map(t => t.length)) * size * CHAR_WIDTH + 8
        const h = textArr.length * size * 1.25 + 4
        const box = { x: at.x - w / 2, y: at.y - h / 2, w, h }
        labels.push(`<rect x="${box.x}" y="${box.y}" width="${w}" height="${h}" fill="${background}" opacity="0.85"/>`)
        labels.push(textLines(textArr, box, { ...st, align: 'center', verticalAlign: 'middle' }, defaultInk))
      }
      continue
    }
    if (!cell.vertex) continue
    const parent = cell.parent ? byId.get(cell.parent) : undefined
    if (parent?.edge) {
      // An edge label stored as a child vertex: place it at the edge's middle.
      const path = edgePath(parent)
      const mid = path?.[Math.floor((path.length - 1) / 2)]
      const next = path?.[Math.floor((path.length - 1) / 2) + 1] ?? mid
      if (!mid || !next) continue
      const text = labelText(cell.value, isHtml)
      const size = n(st.fontSize, 11)
      const w = Math.max(...text.split('\n').map(t => t.length), 1) * size * CHAR_WIDTH + 8
      labels.push(textLines(text.split('\n'), { x: (mid.x + next.x) / 2 - w / 2, y: (mid.y + next.y) / 2 - size, w, h: size * 2 }, st, defaultInk))
      continue
    }
    const box = boxOf(cell)
    if (!box) continue
    vertices++
    extents.push(box)
    const fill = color(st.fillColor, st.shape === 'text' ? 'none' : dark ? '#2b2b3d' : '#ffffff')
    const stroke = color(st.strokeColor, st.shape === 'text' ? 'none' : defaultStroke)
    const width = n(st.strokeWidth, 1)
    const dash = st.dashed === '1' ? ` stroke-dasharray="${width * 4} ${width * 3}"` : ''
    const paint = `fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash}`
    const opacity = st.opacity ? ` opacity="${n(st.opacity, 100) / 100}"` : ''
    const rotate = st.rotation ? ` transform="rotate(${n(st.rotation)} ${box.x + box.w / 2} ${box.y + box.h / 2})"` : ''
    const { x, y, w, h } = box
    let shape = ''
    let labelBox: Box = box
    switch (st.shape) {
      case 'text':
      case 'label':
        shape = fill !== 'none' || stroke !== 'none' ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${paint}/>` : ''
        break
      case 'ellipse':
      case 'doubleEllipse':
        shape = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${paint}/>`
        break
      case 'rhombus':
        shape = `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${paint}/>`
        break
      case 'triangle':
        shape = `<polygon points="${x},${y} ${x + w},${y + h / 2} ${x},${y + h}" ${paint}/>`
        break
      case 'swimlane': {
        const head = n(st.startSize, 23)
        // Transposed, a horizontal swimlane becomes a vertical one and back.
        const horizontal = (st.horizontal !== '0') !== !!options.transpose
        shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${st.swimlaneFillColor ? color(st.swimlaneFillColor, 'none') : 'none'}" stroke="${stroke}" stroke-width="${width}"/>` +
          (horizontal
            ? `<rect x="${x}" y="${y}" width="${w}" height="${head}" ${paint}/>`
            : `<rect x="${x}" y="${y}" width="${head}" height="${h}" ${paint}/>`)
        labelBox = horizontal ? { x, y, w, h: head } : { x, y, w: head, h }
        break
      }
      case 'image':
        shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#adb5bd" stroke-dasharray="6 4"/>`
        break
      default: {
        const rx = st.rounded === '1' ? Math.min(w, h) * (n(st.arcSize, 20) / 200) : 0
        shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${paint}/>`
      }
    }
    if (shape) shapeParts.push(`<g${opacity}${rotate}>${shape}</g>`)
    const text = labelText(cell.value, isHtml) || (st.shape === 'image' ? 'image' : '')
    if (text) labels.push(textLines(wrapLabel(text, labelBox, st, swap), labelBox, st, defaultInk))
  }

  if (extents.length === 0) {
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80"><rect width="320" height="80" fill="${background}"/>` +
        `<text x="160" y="45" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="${defaultInk}">Empty page</text></svg>`,
      vertices,
      edges,
      page: page.name,
    }
  }
  const pad = 20
  const minX = Math.min(...extents.map(b => b.x)) - pad
  const minY = Math.min(...extents.map(b => b.y)) - pad
  const width = Math.round(Math.max(...extents.map(b => b.x + b.w)) + pad - minX)
  const height = Math.round(Math.max(...extents.map(b => b.y + b.h)) + pad - minY)
  const defs = [...markers.entries()]
    .map(([c, id]) =>
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" ` +
    `font-family="Helvetica, Arial, system-ui, sans-serif"><defs>${defs}</defs>` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${background === 'none' ? '#ffffff' : background}"/>` +
    shapeParts.join('') + lineParts.join('') + labels.join('') +
    `</svg>`
  return { svg, vertices, edges, page: page.name }
}

/** Render one page of an uncompressed file (page index 0-based). */
export function drawioToSvg(source: string, pageIndex = 0, options: { transpose?: boolean | 'swap' } = {}): DrawioRender & { pages: number } {
  const pages = listPages(source)
  const page = pages[Math.min(Math.max(0, pageIndex), pages.length - 1)]
  if (!page) throw new Error('the file has no pages')
  return { ...pageToSvg(page, options), pages: pages.length }
}
