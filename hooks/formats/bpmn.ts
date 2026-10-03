// BPMN 2.0 (.bpmn) → standalone SVG, no scripts. The layout is the file's own BPMN DI
// (shape bounds and edge waypoints), so nothing is laid out here; this only paints it.
import { CHAR_WIDTH, esc, wrapLines } from '../common'
import { child, parseXml, walk } from '../xml'
import type { XmlNode } from '../xml'

export type BpmnDiagram = { index: number; id: string; name: string; plane: XmlNode }
export type BpmnRender = { svg: string; shapes: number; edges: number; diagram: string; counts: Record<string, number> }

type Box = { x: number; y: number; w: number; h: number }

const INK = '#22242a'
const FILL = '#ffffff'
const FONT = 'Arial, Helvetica, system-ui, sans-serif'

const TASKS = new Set([
  'task', 'userTask', 'serviceTask', 'sendTask', 'receiveTask', 'manualTask', 'scriptTask',
  'businessRuleTask', 'callActivity', 'subProcess', 'transaction', 'adHocSubProcess',
])
const EVENTS = new Set([
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
])
const GATEWAYS = new Set(['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'complexGateway'])

function n(value: string | undefined, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function boundsOf(node: XmlNode | undefined): Box | undefined {
  const b = node && child(node, 'Bounds')
  return b ? { x: n(b.attrs.x), y: n(b.attrs.y), w: n(b.attrs.width), h: n(b.attrs.height) } : undefined
}

function safeColor(value: string | undefined): string | undefined {
  return value && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgba?\([\d.,\s%]+\)$/.test(value) ? value : undefined
}

export function listDiagrams(source: string): BpmnDiagram[] {
  const doc = parseXml(source)
  const diagrams: BpmnDiagram[] = []
  walk(doc, node => {
    if (node.local !== 'BPMNDiagram') return
    const plane = child(node, 'BPMNPlane')
    if (plane) {
      diagrams.push({ index: diagrams.length, id: node.attrs.id ?? '', name: node.attrs.name ?? `Diagram ${diagrams.length + 1}`, plane })
    }
  })
  if (diagrams.length === 0) throw new Error('no BPMN diagram (BPMNDiagram/BPMNPlane) in the file — it has no layout to draw')
  return diagrams
}

/**
 * Text lines centred in a box, wrapped to its width and kept inside it: lines that do
 * not fit are cut, the last kept line ending in "…", so a long name never spills over
 * the shape's border or the flows around it.
 */
function centred(text: string, box: Box, size: number, color = INK, wrap = true): string {
  const perLine = (box.w - 8) / (size * CHAR_WIDTH)
  let lines = wrap ? wrapLines(text, perLine) : text.split('\n')
  const step = size * 1.2
  const room = Math.max(1, Math.floor(box.h / step))
  if (lines.length > room) {
    lines = lines.slice(0, room)
    const lastLine = lines[room - 1] ?? ''
    lines[room - 1] = `${lastLine.slice(0, Math.max(1, Math.floor(perLine) - 1)).trimEnd()}…`
  }
  const top = box.y + Math.max(0, (box.h - lines.length * step) / 2) + size * 0.9
  return `<text font-size="${size}" fill="${color}" text-anchor="middle">` +
    lines.map((l, i) => `<tspan x="${box.x + box.w / 2}" y="${top + i * step}">${esc(l) || ' '}</tspan>`).join('') +
    `</text>`
}

/** A small marker drawn in a task's top-left corner. */
function taskMarker(kind: string, x: number, y: number, stroke: string): string {
  const s = `stroke="${stroke}" stroke-width="1.2" fill="none"`
  switch (kind) {
    case 'userTask':
      return `<circle cx="${x + 9}" cy="${y + 6}" r="3.5" ${s}/><path d="M${x + 2},${y + 18} q0,-7 7,-7 q7,0 7,7 z" ${s}/>`
    case 'serviceTask':
      // A gear: a thick dashed ring (the teeth) around a hub.
      return `<circle cx="${x + 9}" cy="${y + 10}" r="6" stroke="${stroke}" stroke-width="2.4" stroke-dasharray="2.5 1.6" fill="none"/>` +
        `<circle cx="${x + 9}" cy="${y + 10}" r="2.5" ${s}/>`
    case 'sendTask':
      return `<rect x="${x + 1}" y="${y + 4}" width="16" height="11" fill="${stroke}"/><path d="M${x + 1},${y + 4} l8,6 l8,-6" stroke="${FILL}" stroke-width="1.2" fill="none"/>`
    case 'receiveTask':
      return `<rect x="${x + 1}" y="${y + 4}" width="16" height="11" ${s}/><path d="M${x + 1},${y + 4} l8,6 l8,-6" ${s}/>`
    case 'scriptTask':
      return `<path d="M${x + 4},${y + 2} h11 q-4,8 0,16 h-11 q4,-8 0,-16 z M${x + 6},${y + 7} h6 M${x + 6},${y + 11} h6" ${s}/>`
    case 'businessRuleTask':
      return `<rect x="${x + 1}" y="${y + 3}" width="16" height="12" ${s}/><path d="M${x + 1},${y + 7} h16 M${x + 6},${y + 7} v8" ${s}/>`
    case 'manualTask':
      return `<path d="M${x + 2},${y + 14} v-6 l4,-4 h9 v3 h-6 m-3,0 h9 v3 h-8 m0,0 h7 v3 h-8 v1 h-4 z" ${s}/>`
    default:
      return ''
  }
}

function eventMarker(defs: string[], box: Box, stroke: string, isThrow: boolean): string {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = box.w / 2
  const fill = isThrow ? stroke : 'none'
  const s = `stroke="${stroke}" stroke-width="1.4"`
  if (defs.includes('timerEventDefinition')) {
    const rr = r * 0.6
    const ticks = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6
      return `M${cx + Math.cos(a) * rr * 0.8},${cy + Math.sin(a) * rr * 0.8} L${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`
    }).join(' ')
    return `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${FILL}" ${s}/><path d="${ticks} M${cx},${cy} L${cx},${cy - rr * 0.7} M${cx},${cy} L${cx + rr * 0.5},${cy}" ${s} fill="none"/>`
  }
  if (defs.includes('messageEventDefinition')) {
    const w = r * 1.1
    const h = r * 0.75
    return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="${fill}" ${s}/>` +
      `<path d="M${cx - w / 2},${cy - h / 2} L${cx},${cy + h * 0.1} L${cx + w / 2},${cy - h / 2}" fill="none" stroke="${isThrow ? FILL : stroke}" stroke-width="1.4"/>`
  }
  if (defs.includes('terminateEventDefinition')) return `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${stroke}"/>`
  if (defs.includes('signalEventDefinition')) {
    return `<path d="M${cx},${cy - r * 0.55} L${cx + r * 0.5},${cy + r * 0.35} L${cx - r * 0.5},${cy + r * 0.35} z" fill="${fill}" ${s}/>`
  }
  if (defs.includes('errorEventDefinition')) {
    return `<path d="M${cx - r * 0.45},${cy + r * 0.45} L${cx - r * 0.15},${cy - r * 0.45} L${cx + r * 0.1},${cy + r * 0.1} L${cx + r * 0.45},${cy - r * 0.45} L${cx + r * 0.15},${cy + r * 0.45} L${cx - r * 0.1},${cy - r * 0.1} z" fill="${fill}" ${s}/>`
  }
  if (defs.includes('escalationEventDefinition')) {
    return `<path d="M${cx},${cy - r * 0.5} L${cx + r * 0.35},${cy + r * 0.45} L${cx},${cy + r * 0.1} L${cx - r * 0.35},${cy + r * 0.45} z" fill="${fill}" ${s}/>`
  }
  if (defs.includes('conditionalEventDefinition')) {
    const w = r * 0.8
    return `<rect x="${cx - w / 2}" y="${cy - w * 0.6}" width="${w}" height="${w * 1.2}" fill="${FILL}" ${s}/>` +
      `<path d="M${cx - w * 0.3},${cy - w * 0.3} h${w * 0.6} M${cx - w * 0.3},${cy} h${w * 0.6} M${cx - w * 0.3},${cy + w * 0.3} h${w * 0.6}" ${s}/>`
  }
  return ''
}

function gatewayMarker(kind: string, box: Box, stroke: string, showX: boolean): string {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const k = box.w * 0.2
  const s = `stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" fill="none"`
  switch (kind) {
    case 'exclusiveGateway':
      return showX ? `<path d="M${cx - k},${cy - k} L${cx + k},${cy + k} M${cx + k},${cy - k} L${cx - k},${cy + k}" ${s}/>` : ''
    case 'parallelGateway':
      return `<path d="M${cx},${cy - k * 1.3} L${cx},${cy + k * 1.3} M${cx - k * 1.3},${cy} L${cx + k * 1.3},${cy}" ${s}/>`
    case 'inclusiveGateway':
      return `<circle cx="${cx}" cy="${cy}" r="${k * 1.2}" stroke="${stroke}" stroke-width="2.5" fill="none"/>`
    case 'complexGateway':
      return `<path d="M${cx},${cy - k * 1.3} L${cx},${cy + k * 1.3} M${cx - k * 1.3},${cy} L${cx + k * 1.3},${cy} M${cx - k},${cy - k} L${cx + k},${cy + k} M${cx + k},${cy - k} L${cx - k},${cy + k}" ${s}/>`
    case 'eventBasedGateway': {
      const r = k * 1.4
      const pent = Array.from({ length: 5 }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
        return `${cx + Math.cos(a) * r * 0.6},${cy + Math.sin(a) * r * 0.6}`
      }).join(' ')
      return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${stroke}" stroke-width="1.2" fill="none"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r * 0.82}" stroke="${stroke}" stroke-width="1.2" fill="none"/>` +
        `<polygon points="${pent}" stroke="${stroke}" stroke-width="1.2" fill="none"/>`
    }
    default:
      return ''
  }
}

function median(values: number[]): number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * The transpose mapping: swap the axes and rescale them by the typical task's aspect
 * ratio (new x = old y · w/h, new y = old x · h/w). A task keeps its size, so its label
 * still fits, and a flow that met its right edge now meets its bottom edge. Containers
 * (pools, lanes) map corner to corner instead, so rows of lanes become columns.
 */
type Mapping = { box: (b: Box, isContainer: boolean) => Box; point: (x: number, y: number) => { x: number; y: number } }

function transposeMapping(taskBoxes: Box[], swap = false): Mapping {
  // `swap` is the exact axis swap (every shape's width and height swap too): the fallback
  // when keeping task sizes does not turn the diagram to the other orientation.
  const mw = median(taskBoxes.map(b => b.w))
  const mh = median(taskBoxes.map(b => b.h))
  const sx = !swap && mw && mh ? mw / mh : 1
  const sy = !swap && mw && mh ? mh / mw : 1
  const point = (x: number, y: number) => ({ x: y * sx, y: x * sy })
  return {
    point,
    box: (b, isContainer) => {
      const c = point(b.x + b.w / 2, b.y + b.h / 2)
      const [w, h] = swap || isContainer ? [b.h * sx, b.w * sy] : [b.w, b.h]
      return { x: c.x - w / 2, y: c.y - h / 2, w, h }
    },
  }
}

const IDENTITY: Mapping = { box: b => b, point: (x, y) => ({ x, y }) }

export function diagramToSvg(source: string, index = 0, options: { transpose?: boolean | 'swap' } = {}): BpmnRender & { diagrams: number } {
  const diagrams = listDiagrams(source)
  const diagram = diagrams[Math.min(Math.max(0, index), diagrams.length - 1)] as BpmnDiagram

  // Semantic model: every element with an id, outside the diagram interchange.
  const doc = parseXml(source)
  const byId = new Map<string, XmlNode>()
  walk(doc, node => {
    if (node.attrs.id && !node.name.startsWith('bpmndi:') && node.local !== 'BPMNDiagram') byId.set(node.attrs.id, node)
  })

  const map = options.transpose
    ? transposeMapping(diagram.plane.children
      .filter(di => di.local === 'BPMNShape' && TASKS.has(byId.get(di.attrs.bpmnElement ?? '')?.local ?? ''))
      .map(di => boundsOf(di))
      .filter((b): b is Box => !!b), options.transpose === 'swap')
    : IDENTITY

  const pools: string[] = []
  const lanes: string[] = []
  const flows: string[] = []
  const nodes: string[] = []
  const overlays: string[] = []
  const labels: string[] = []
  const extents: Box[] = []
  const counts: Record<string, number> = {}
  let shapes = 0
  let edges = 0
  const markers = new Map<string, string>()
  const arrowFor = (color: string, open = false): string => {
    const key = `${color}|${open}`
    if (!markers.has(key)) markers.set(key, `ar${markers.size}`)
    return markers.get(key) as string
  }

  for (const di of diagram.plane.children) {
    const element = di.attrs.bpmnElement ? byId.get(di.attrs.bpmnElement) : undefined
    const kind = element?.local ?? 'unknown'
    const name = element?.attrs.name ?? ''
    const stroke = safeColor(di.attrs['bioc:stroke'] ?? di.attrs['color:border-color']) ?? INK
    const fill = safeColor(di.attrs['bioc:fill'] ?? di.attrs['color:background-color']) ?? FILL
    const rawLabel = boundsOf(child(di, 'BPMNLabel') ?? undefined)
    const labelBox = rawLabel && map.box(rawLabel, false)

    if (di.local === 'BPMNShape') {
      const raw = boundsOf(di)
      if (!raw) continue
      const isContainer = kind === 'participant' || kind === 'lane'
      const box = map.box(raw, isContainer)
      shapes++
      counts[kind] = (counts[kind] ?? 0) + 1
      extents.push(box)
      const { x, y, w, h } = box
      // Transposed, a horizontal pool or lane becomes a vertical one (header on top).
      const horizontal = (di.attrs.isHorizontal !== 'false') !== !!options.transpose

      if (kind === 'participant' || kind === 'lane') {
        const head = 30
        const target = kind === 'participant' ? pools : lanes
        const isPool = kind === 'participant'
        target.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${isPool ? fill : 'none'}" stroke="${stroke}" stroke-width="1.5"/>`)
        if (isPool || name) {
          if (horizontal) {
            target.push(`<line x1="${x + head}" y1="${y}" x2="${x + head}" y2="${y + h}" stroke="${stroke}" stroke-width="1.5"/>`)
            const cx = x + head / 2
            const cy = y + h / 2
            labels.push(`<text font-size="12" fill="${INK}" text-anchor="middle" transform="rotate(-90 ${cx} ${cy})" x="${cx}" y="${cy + 4}">${esc(name)}</text>`)
          } else {
            target.push(`<line x1="${x}" y1="${y + head}" x2="${x + w}" y2="${y + head}" stroke="${stroke}" stroke-width="1.5"/>`)
            labels.push(centred(name, { x, y, w, h: head }, 12, INK, false))
          }
        }
        continue
      }

      if (TASKS.has(kind)) {
        const isCall = kind === 'callActivity'
        const expanded = di.attrs.isExpanded === 'true'
        nodes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${isCall ? 4 : 2}"/>`)
        if (kind === 'transaction') nodes.push(`<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="8" fill="none" stroke="${stroke}" stroke-width="1.2"/>`)
        const marker = taskMarker(kind, x + 5, y + 5, stroke)
        nodes.push(marker)
        if ((kind === 'subProcess' || isCall) && !expanded) {
          nodes.push(`<rect x="${x + w / 2 - 7}" y="${y + h - 16}" width="14" height="14" fill="none" stroke="${stroke}"/>` +
            `<path d="M${x + w / 2 - 4},${y + h - 9} h8 M${x + w / 2},${y + h - 13} v8" stroke="${stroke}"/>`)
        }
        if (name) {
          // A marker owns the top-left corner, so the label starts below it.
          const top = marker ? 22 : 4
          labels.push(expanded
            ? centred(name, { x, y: y + top, w, h: 20 }, 12, INK)
            : centred(name, { x: x + 2, y: y + top, w: w - 4, h: h - top - 6 }, 12, INK))
        }
        continue
      }

      if (EVENTS.has(kind)) {
        const defs = (element?.children ?? []).map(c => c.local).filter(l => l.endsWith('EventDefinition'))
        const cx = x + w / 2
        const cy = y + h / 2
        const r = w / 2
        const isEnd = kind === 'endEvent'
        const isIntermediate = kind.startsWith('intermediate') || kind === 'boundaryEvent'
        const dashed = (kind === 'boundaryEvent' && element?.attrs.cancelActivity === 'false') ||
          (kind === 'startEvent' && element?.attrs.isInterrupting === 'false')
        const dash = dashed ? ' stroke-dasharray="5 3"' : ''
        const target = kind === 'boundaryEvent' ? overlays : nodes
        target.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${isEnd ? 4 : isIntermediate ? 1.5 : 2}"${dash}/>`)
        if (isIntermediate) target.push(`<circle cx="${cx}" cy="${cy}" r="${r - 3}" fill="none" stroke="${stroke}" stroke-width="1.5"${dash}/>`)
        target.push(eventMarker(defs, box, stroke, isEnd || kind === 'intermediateThrowEvent'))
        if (name) labels.push(centred(name, labelBox ?? { x: cx - 50, y: y + h + 2, w: 100, h: 28 }, 11))
        continue
      }

      if (GATEWAYS.has(kind)) {
        const cx = x + w / 2
        const cy = y + h / 2
        nodes.push(`<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`)
        nodes.push(gatewayMarker(kind, box, stroke, di.attrs.isMarkerVisible !== 'false'))
        if (name) labels.push(centred(name, labelBox ?? { x: cx - 60, y: y + h + 2, w: 120, h: 28 }, 11))
        continue
      }

      if (kind === 'dataObjectReference' || kind === 'dataObject' || kind === 'dataInput' || kind === 'dataOutput') {
        const fold = Math.min(10, w / 3)
        nodes.push(`<path d="M${x},${y} h${w - fold} l${fold},${fold} v${h - fold} h${-w} z M${x + w - fold},${y} v${fold} h${fold}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
        if (name) labels.push(centred(name, labelBox ?? { x: x - 30, y: y + h + 2, w: w + 60, h: 28 }, 11))
        continue
      }
      if (kind === 'dataStoreReference') {
        const e = Math.min(8, h / 5)
        nodes.push(`<path d="M${x},${y + e} a${w / 2},${e} 0 0 0 ${w},0 a${w / 2},${e} 0 0 0 ${-w},0 v${h - 2 * e} a${w / 2},${e} 0 0 0 ${w},0 v${-(h - 2 * e)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`)
        if (name) labels.push(centred(name, labelBox ?? { x: x - 30, y: y + h + 2, w: w + 60, h: 28 }, 11))
        continue
      }
      if (kind === 'textAnnotation') {
        const text = element ? (child(element, 'text')?.text ?? '') : ''
        nodes.push(`<path d="M${x + 12},${y} h-12 v${h} h12" fill="none" stroke="${stroke}" stroke-width="1.5"/>`)
        const lines = wrapLines(text.trim(), (w - 10) / (11 * CHAR_WIDTH))
        labels.push(`<text font-size="11" fill="${INK}">` +
          lines.map((l, i) => `<tspan x="${x + 6}" y="${y + 14 + i * 13}">${esc(l) || ' '}</tspan>`).join('') + `</text>`)
        continue
      }
      if (kind === 'group') {
        nodes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="8 4 2 4"/>`)
        const categoryName = element?.attrs.categoryValueRef ? byId.get(element.attrs.categoryValueRef)?.attrs.value ?? '' : ''
        if (categoryName) labels.push(centred(categoryName, labelBox ?? { x, y: y + 2, w, h: 18 }, 11))
        continue
      }
      // Unknown shape kinds still show where they are.
      nodes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-dasharray="4 3"/>`)
      if (name) labels.push(centred(name, box, 11))
      continue
    }

    if (di.local === 'BPMNEdge') {
      const pts = di.children.filter(c => c.local === 'waypoint').map(p => map.point(n(p.attrs.x), n(p.attrs.y)))
      if (pts.length < 2) continue
      edges++
      counts[kind] = (counts[kind] ?? 0) + 1
      pts.forEach(p => extents.push({ x: p.x, y: p.y, w: 0, h: 0 }))
      const d = `M${pts.map(p => `${p.x},${p.y}`).join(' L')}`
      const edgeStroke = safeColor(di.attrs['bioc:stroke'] ?? di.attrs['color:border-color']) ?? INK
      if (kind === 'messageFlow') {
        flows.push(`<path d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="1.5" stroke-dasharray="8 5" marker-end="url(#${arrowFor(edgeStroke, true)})"/>`)
        const p0 = pts[0] as { x: number; y: number }
        flows.push(`<circle cx="${p0.x}" cy="${p0.y}" r="4" fill="${FILL}" stroke="${edgeStroke}" stroke-width="1.5"/>`)
      } else if (kind === 'association' || kind === 'dataInputAssociation' || kind === 'dataOutputAssociation') {
        const arrow = kind === 'association' ? '' : ` marker-end="url(#${arrowFor(edgeStroke, true)})"`
        flows.push(`<path d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="1.5" stroke-dasharray="2 4"${arrow}/>`)
      } else {
        flows.push(`<path d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="2" stroke-linejoin="round" marker-end="url(#${arrowFor(edgeStroke)})"/>`)
        // A default flow carries a slash near its source.
        const sourceId = element?.attrs.sourceRef
        if (sourceId && byId.get(sourceId)?.attrs.default === element?.attrs.id) {
          const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }]
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
          const ux = (b.x - a.x) / len
          const uy = (b.y - a.y) / len
          const mx = a.x + ux * 12
          const my = a.y + uy * 12
          flows.push(`<path d="M${mx - uy * 6 - ux * 4},${my + ux * 6 - uy * 4} L${mx + uy * 6 + ux * 4},${my - ux * 6 + uy * 4}" stroke="${edgeStroke}" stroke-width="2"/>`)
        }
      }
      if (name) {
        const mid = pts[Math.floor((pts.length - 1) / 2)] as { x: number; y: number }
        const next = pts[Math.floor((pts.length - 1) / 2) + 1] ?? mid
        const fallback = { x: (mid.x + next.x) / 2 - 50, y: (mid.y + next.y) / 2 - 22, w: 100, h: 20 }
        labels.push(centred(name, labelBox ?? fallback, 11))
      }
    }
  }

  if (extents.length === 0) throw new Error(`diagram "${diagram.name}" has no shapes`)
  const pad = 20
  const minX = Math.min(...extents.map(b => b.x)) - pad
  const minY = Math.min(...extents.map(b => b.y)) - pad
  const width = Math.round(Math.max(...extents.map(b => b.x + b.w)) + pad - minX)
  const height = Math.round(Math.max(...extents.map(b => b.y + b.h)) + pad - minY)
  const defs = [...markers.entries()]
    .map(([key, id]) => {
      const [color, open] = key.split('|')
      const head = open === 'true'
        ? `<path d="M1,1 L10,5 L1,9" fill="none" stroke="${color}" stroke-width="1.4"/>`
        : `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/>`
      return `<marker id="${id}" viewBox="0 0 11 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">${head}</marker>`
    })
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="${FONT}">` +
    `<defs>${defs}</defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${FILL}"/>` +
    pools.join('') + lanes.join('') + flows.join('') + nodes.join('') + overlays.join('') + labels.join('') +
    `</svg>`
  return { svg, shapes, edges, diagram: diagram.name, counts, diagrams: diagrams.length }
}
