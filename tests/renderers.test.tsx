import { expect, test } from 'claude-code/testing'

import { orientationOf, parseOrientationFlag, stepZoom, zoomLabel, zoomView } from '../hooks/common'
import { diagramToSvg, listDiagrams } from '../hooks/formats/bpmn'
import { canvasToSvg } from '../hooks/formats/canvas'
import { drawioToSvg, labelText, listPages } from '../hooks/formats/drawio'
import { excalidrawToSvg, extractScene, transposeScene } from '../hooks/formats/excalidraw'
import { formatOf, parseArgs } from '../hooks/formats/index'
import { BPMN, CANVAS, DRAWIO, EXCALIDRAW, excalidrawNote, sizeOf } from './fixtures'

// ── canvas ──────────────────────────────────────────────────────────────

test('canvas: every node type, edge label and preset colour', async () => {
  const drawn = canvasToSvg(CANVAS)
  expect([drawn.nodes, drawn.edges]).toEqual([4, 2])
  expect(drawn.svg).toContain('Hello &lt;world&gt;')
  expect(drawn.svg).toContain('>Note<')
  expect(drawn.svg).toContain('https://jsoncanvas')
  expect(drawn.svg).toContain('>Zone<')
  expect(drawn.svg).toContain('>cites<')
  expect(drawn.svg).toContain('#7852ee')
  expect(drawn.svg).not.toContain('<script')
})

test('canvas: transposed, a wide row of cards becomes a tall column', async () => {
  expect(orientationOf(canvasToSvg(CANVAS).svg)).toBe('landscape')
  const turned = canvasToSvg(CANVAS, { transpose: true }).svg
  expect(orientationOf(turned)).toBe('portrait')
  expect(turned).toContain('width="200" height="80"') // cards keep their size
})

test('canvas: very wide cards stay landscape when sizes are kept; the exact swap turns them', async () => {
  const wide = JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: 0, y: 0, width: 1160, height: 200, text: 'wide card one' },
      { id: 'b', type: 'text', x: 0, y: 260, width: 1160, height: 200, text: 'wide card two' },
      { id: 'c', type: 'text', x: 1200, y: 0, width: 360, height: 140, text: 'small' },
    ],
    edges: [],
  })
  expect(orientationOf(canvasToSvg(wide).svg)).toBe('landscape')
  expect(orientationOf(canvasToSvg(wide, { transpose: true }).svg)).toBe('landscape')
  const turned = canvasToSvg(wide, { transpose: 'swap' }).svg
  expect(orientationOf(turned)).toBe('portrait')
  expect(turned).toContain('width="200" height="1160"') // the card itself turned
})

test('every renderer turns its fixture to the other orientation with the exact swap', async () => {
  const natural = [canvasToSvg(CANVAS).svg, excalidrawToSvg(EXCALIDRAW).svg, drawioToSvg(DRAWIO, 0).svg, diagramToSvg(BPMN).svg]
  const swapped = [
    canvasToSvg(CANVAS, { transpose: 'swap' }).svg,
    excalidrawToSvg(EXCALIDRAW, { transpose: 'swap' }).svg,
    drawioToSvg(DRAWIO, 0, { transpose: 'swap' }).svg,
    diagramToSvg(BPMN, 0, { transpose: 'swap' }).svg,
  ]
  natural.forEach((svg, i) => {
    expect(orientationOf(swapped[i] ?? '')).not.toBe(orientationOf(svg))
  })
})

// ── excalidraw ──────────────────────────────────────────────────────────

test('excalidraw: draws every supported element and skips deleted ones', async () => {
  const drawn = excalidrawToSvg(EXCALIDRAW)
  expect(drawn.elements).toBe(7)
  expect(drawn.format).toBe('json')
  for (const part of ['<rect', '<ellipse', '<polygon', 'marker-end', 'Start &lt;here&gt;', '#b2f2bb']) {
    expect(drawn.svg).toContain(part)
  }
})

test('excalidraw: embedded images become named placeholders; a missing drawing is an error', async () => {
  const drawn = excalidrawToSvg(excalidrawNote(
    [{ id: 'i', type: 'image', x: 0, y: 0, width: 100, height: 80, fileId: 'abcdef0123456789' }],
    'abcdef0123456789: [[Pasted image 2026.png]]',
  ))
  expect(drawn.skipped).toEqual(['Pasted image 2026.png'])
  expect(() => extractScene('# Just a note')).toThrow('no "## Drawing" block found')
})

test('excalidraw: transposing keeps box sizes and keeps arrows on box edges', async () => {
  const [lane, a, b, arrow] = transposeScene([
    { id: 'lane', type: 'rectangle', x: 0, y: 0, width: 1000, height: 60 },
    { id: 'a', type: 'rectangle', x: 100, y: 15, width: 80, height: 30 },
    { id: 'b', type: 'rectangle', x: 300, y: 15, width: 80, height: 30 },
    { id: 'arr', type: 'arrow', x: 180, y: 30, width: 120, height: 0, points: [[0, 0], [120, 0]] },
  ] as never[]) as Array<{ x: number; y: number; width: number; height: number; points?: [number, number][] }>
  expect(lane?.height).toBeGreaterThan(lane?.width ?? 0)
  expect([a?.width, a?.height]).toEqual([80, 30])
  const endY = (arrow?.y ?? 0) + (arrow?.points?.[1]?.[1] ?? 0)
  expect(Math.abs((arrow?.y ?? 0) - ((a?.y ?? 0) + (a?.height ?? 0)))).toBeLessThan(0.01)
  expect(Math.abs(endY - (b?.y ?? 0))).toBeLessThan(0.01)
})

// ── draw.io ─────────────────────────────────────────────────────────────

test('draw.io: shapes, edges, waypoints, containers and wrapped labels', async () => {
  const drawn = drawioToSvg(DRAWIO, 0)
  expect([drawn.pages, drawn.edges]).toEqual([2, 2])
  for (const part of ['>Start<', '>here<', '<polygon', '<ellipse', 'stroke-dasharray', '320,40', 'x="20" y="160"', 'Wrapped label', '>yes<']) {
    expect(drawn.svg).toContain(part)
  }
  expect(listPages(DRAWIO).map(p => p.name)).toEqual(['Overview', 'Details'])
  expect(drawioToSvg(DRAWIO, 1).svg).toContain('fill="#1a1a2e"')
  expect(labelText('<div>One</div><div>Two&nbsp;three</div>', true)).toBe('One\nTwo three')
})

test('draw.io: transposed, the page turns portrait and the swimlane becomes vertical', async () => {
  expect(orientationOf(drawioToSvg(DRAWIO, 0).svg)).toBe('landscape')
  const turned = drawioToSvg(DRAWIO, 0, { transpose: true }).svg
  expect(orientationOf(turned)).toBe('portrait')
  expect(turned).toContain('width="120" height="60"') // ordinary shapes keep their size
})

// ── BPMN ────────────────────────────────────────────────────────────────

test('bpmn: pools, lanes, tasks, events, gateways, flows and colours', async () => {
  const drawn = diagramToSvg(BPMN)
  expect([drawn.diagrams, drawn.shapes, drawn.edges]).toEqual([2, 10, 5])
  expect(drawn.counts).toMatchObject({ participant: 1, lane: 2, userTask: 1, serviceTask: 1, boundaryEvent: 1, exclusiveGateway: 1 })
  for (const part of ['Orders &amp; Billing', 'rotate(-90', '>&lt;order&gt;<', 'stroke-dasharray="5 3"', '#ffebee', '>yes<']) {
    expect(drawn.svg).toContain(part)
  }
  expect(listDiagrams(BPMN).map(d => d.name)).toEqual(['Main', 'Finance only'])
  expect(() => listDiagrams('<bpmn:definitions/>')).toThrow('no BPMN diagram')
})

test('bpmn: long names are cut with an ellipsis; transposed, flows still meet task edges', async () => {
  const long = BPMN.replace('Credit check', 'Credit check against the open receivables of every related account and group company')
  expect(diagramToSvg(long).svg).toContain('…')
  const turned = diagramToSvg(BPMN, 0, { transpose: true }).svg
  expect(sizeOf(turned).h).toBeGreaterThan(sizeOf(turned).w)
  expect(turned).toContain('x="43.75" y="128" width="100" height="80"')
  expect(turned).toContain('M143.75,168 L231.25,168')
})

// ── shared helpers ──────────────────────────────────────────────────────

test('formats, arguments, orientation flags and zoom steps', async () => {
  expect(['a.canvas', 'b.excalidraw.md', 'c.drawio', 'd.bpmn', 'e.md'].map(formatOf))
    .toEqual(['canvas', 'excalidraw', 'drawio', 'bpmn', undefined])
  expect(parseArgs('maps/flow chart.drawio 2 --portrait')).toEqual({ path: 'maps/flow chart.drawio', page: '2', orientation: 'portrait' })
  expect(parseArgs('"x y.bpmn" Main')).toEqual({ path: 'x y.bpmn', page: 'Main', orientation: undefined })
  expect(parseOrientationFlag('a.canvas --LANDSCAPE')).toEqual({ rest: 'a.canvas', orientation: 'landscape' })
  expect(stepZoom(1, -1)).toBe(0.75)
  expect(stepZoom(0, 1)).toBe(1.25) // an older 0 reads as fit
  expect(stepZoom(8, 1)).toBe(8) // clamped at the top
})

test('zoomView crops or widens the viewBox and reports the visible span', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200" viewBox="0 0 1000 200"><rect/></svg>'
  expect(zoomView(svg, 1).svg).toBe(svg)
  const inRight = zoomView(svg, 2, 1)
  expect(inRight.svg).toContain('viewBox="500 0 500 200"')
  expect(inRight.svg).toContain('width="500" height="200"')
  expect([inRight.from, inRight.to]).toEqual([0.5, 1])
  const out = zoomView(svg, 0.5)
  expect(out.svg).toContain('viewBox="-500 0 2000 200"') // centred in a twice-as-wide view
  expect(zoomLabel(2, 0.5, 1)).toBe('zoom 200% · showing 50–100%')
  expect(zoomLabel(1)).toBe('fit width')
  // An export without a viewBox gets one from its width and height.
  expect(zoomView('<svg width="400px" height="100px"><g/></svg>', 2).svg).toContain('viewBox="0 0 200 100"')
})
