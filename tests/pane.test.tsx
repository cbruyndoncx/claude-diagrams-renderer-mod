import { expect, test } from 'claude-code/testing'

import { BPMN, CANVAS, D2, DRAWIO, EXCALIDRAW, d2Svg, sizeOf } from './fixtures'

// `claude plugin test` gives the plugin no real filesystem, environment or processes:
// the test's hooks stand for the engine and serve a vault with one diagram per format.
const ROOT = 'C:\\vault'
const FILES: Record<string, string> = {
  'maps/home.canvas': CANVAS,
  'maps/flow.excalidraw.md': EXCALIDRAW,
  'maps/flow chart.drawio': DRAWIO,
  'maps/order.bpmn': BPMN,
  'maps/flow.d2': D2,
}
const realOf = (rel: string) => `${ROOT}\\${rel.split('/').join('\\')}`
const EXE = 'C:\\Program Files\\draw.io\\draw.io.exe'
const EXCALIDRAW_EXPORT = realOf('maps/flow.excalidraw.svg')
const EXPORTED = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="100"><text>external export</text></svg>'

type Host = {
  content?: Record<string, string>
  inVault?: boolean
  drawioInstalled?: boolean
  excalidrawExport?: 'newer' | 'older'
  exports?: string[]
  /** `missing`: no d2 anywhere. Every d2 stdin is recorded in `d2Inputs`. */
  d2?: 'wsl' | 'missing'
  d2Inputs?: string[]
}

function serveHost(on: Parameters<Parameters<typeof test>[1]>[1], host: Host = {}) {
  const content = host.content ?? { ...FILES }
  const written = new Map<string, string>()
  const fileAt = (path: string) => {
    const norm = path.replace(/\//g, '\\')
    return Object.keys(content).find(rel => norm === realOf(rel) || norm.endsWith(rel.split('/').join('\\')))
  }
  on('fs.stat', ($, e) => {
    const rel = fileAt(e.path)
    if (rel) return { value: { kind: 'file', size: content[rel]?.length ?? 0, mtimeMs: 1000, isLink: false, realPath: realOf(rel) } }
    if (e.path === EXCALIDRAW_EXPORT && host.excalidrawExport) {
      return { value: { kind: 'file', size: EXPORTED.length, mtimeMs: host.excalidrawExport === 'newer' ? 2000 : 500, isLink: false, realPath: e.path } }
    }
    if (written.has(e.path)) return { value: { kind: 'file', size: 10, mtimeMs: 3000, isLink: false, realPath: e.path } }
    return { deny: `ENOENT ${e.path}` }
  })
  on('fs.exists', ($, e) => ({
    value: (host.inVault !== false && e.path === `${ROOT}\\.obsidian`) || (!!host.drawioInstalled && e.path === EXE),
  }))
  on('fs.read', ($, e) => {
    const rel = fileAt(e.path)
    if (rel) return { value: content[rel] ?? '' }
    if (e.path === EXCALIDRAW_EXPORT && host.excalidrawExport) return { value: EXPORTED }
    const out = written.get(e.path)
    return out !== undefined ? { value: out } : { deny: `ENOENT ${e.path}` }
  })
  on('env.get', ($, e) => ({ value: ({ ProgramFiles: 'C:\\Program Files', TEMP: 'C:\\Temp' } as Record<string, string>)[e.name] }))
  on('process.run', ($, e) => {
    const argv = e.argv as string[]
    if (argv[0] === 'd2') return { deny: 'spawn d2 ENOENT' } // no d2 on the Windows PATH
    if (argv[0] === 'wsl.exe' && argv.join(' ').includes('d2')) {
      const input = String(e.init?.stdin ?? '')
      host.d2Inputs?.push(input)
      if (host.d2 === 'missing') return { value: { exitCode: 127, stdout: '', stderr: 'bash: line 1: d2: command not found' } }
      if (input.includes('-> {')) {
        return { value: { exitCode: 1, stdout: '', stderr: 'err: failed to compile -: -:1:1: connection missing destination\n' } }
      }
      return { value: { exitCode: 0, stdout: d2Svg(input.startsWith('direction: down')), stderr: 'success: compiled' } }
    }
    host.exports?.push(argv.join(' '))
    written.set(argv[argv.indexOf('--output') + 1] ?? '', EXPORTED)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return content
}

const mount = ($: Parameters<Parameters<typeof test>[1]>[0], format: string, surface: 'desktop' | 'terminal' = 'desktop') =>
  $.ui.mount({
    plugin: 'diagram-preview',
    surface,
    component: 'Pane',
    requestId: format,
    props: { title: format, isFocused: false, bodyColumns: 100, placement: 'dock' },
  })

test('one command opens every format in its own pane with the same toolbar', async ($, on) => {
  serveHost(on)
  const cases: [string, string, string][] = [
    ['maps/home.canvas', 'canvas', 'Canvas'],
    ['maps/flow.excalidraw.md', 'excalidraw', 'Excalidraw'],
    ['maps/flow chart.drawio', 'drawio', 'Draw.io'],
    ['maps/order.bpmn', 'bpmn', 'BPMN'],
  ]
  for (const [rel, format, label] of cases) {
    const ran = await $.command.run({ command: 'diagram', args: rel })
    expect(ran.text).toBe(`Showing ${rel} in the ${label} pane.`)
  }
  // Each format keeps its own pane: opening the BPMN file left the canvas pane's file alone.
  for (const [rel, format] of cases) {
    const ui = await mount($, format)
    expect(await ui.find({ type: 'Text', text: rel })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    for (const key of ['orientation', 'zoom-out', 'zoom-fit', 'zoom-in', 'refresh', 'open-obsidian']) {
      expect(await ui.find({ key })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('one press of the orientation button switches landscape ↔ portrait', async ($, on) => {
  serveHost(on)
  await $.command.run({ command: 'diagram', args: 'maps/order.bpmn' })
  const ui = await mount($, 'bpmn')
  const svgSize = async () => sizeOf((await ui.find({ type: 'Svg' }))?.props.source)
  const label = async () => (await ui.find({ key: 'orientation' }))?.props.label
  expect(await label()).toBe('Switch to portrait') // natural: landscape
  await ui.press({ key: 'orientation' })
  const tall = await svgSize()
  expect(tall.h).toBeGreaterThan(tall.w)
  expect(await ui.find({ type: 'Text', text: /· portrait ·.*source: built-in renderer, transposed/ })).toBeDefined()
  expect(await label()).toBe('Switch to landscape')
  await ui.press({ key: 'orientation' })
  const wide = await svgSize()
  expect(wide.w).toBeGreaterThan(wide.h)
  expect(await label()).toBe('Switch to portrait')
  await ui.unmount()
})

test('Portrait is honoured even when wide cards keep a size-preserving swap landscape', async ($, on) => {
  serveHost(on, {
    content: {
      ...FILES,
      'maps/wide.canvas': JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', x: 0, y: 0, width: 1160, height: 200, text: 'wide one' },
          { id: 'b', type: 'text', x: 0, y: 260, width: 1160, height: 200, text: 'wide two' },
          { id: 'c', type: 'text', x: 1200, y: 0, width: 360, height: 140, text: 'small' },
        ],
        edges: [],
      }),
    },
  })
  await $.command.run({ command: 'diagram', args: 'maps/wide.canvas --portrait' })
  const ui = await mount($, 'canvas')
  const size = sizeOf((await ui.find({ type: 'Svg' }))?.props.source)
  expect(size.h).toBeGreaterThan(size.w)
  expect((await ui.find({ type: 'Text', text: /source:/ }))?.text).toContain('transposed, shapes turned')
  expect((await ui.find({ key: 'orientation' }))?.props.label).toBe('Switch to landscape')
  await ui.unmount()
})

test('--portrait on the command and orientation on the tool open portrait', async ($, on) => {
  serveHost(on)
  const ran = await $.command.run({ command: 'diagram', args: 'maps/home.canvas --portrait' })
  expect(ran.text).toBe('Showing maps/home.canvas (portrait) in the Canvas pane.')
  const ui = await mount($, 'canvas')
  const size = sizeOf((await ui.find({ type: 'Svg' }))?.props.source)
  expect(size.h).toBeGreaterThan(size.w)
  await ui.unmount()
  const viaTool = await $.tool.call({ tool: 'mcp__diagram-preview__open', path: 'maps/flow chart.drawio', orientation: 'portrait' })
  expect(String(viaTool.result)).toContain('(portrait)')
})

test('zoom crops the view instead of widening the image; pan moves the slice; Fit resets', async ($, on) => {
  serveHost(on)
  await $.command.run({ command: 'diagram', args: 'maps/home.canvas' })
  const ui = await mount($, 'canvas')
  const svg = async () => await ui.find({ type: 'Svg' })
  const viewBox = async () => {
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(String((await svg())?.props.source))
    return { x: Number(m?.[1]), w: Number(m?.[3]) }
  }
  const caption = async () => (await ui.find({ type: 'Text', text: /source:/ }))?.text ?? ''
  const fit = await viewBox()
  expect(await caption()).toContain('fit width')
  expect(await ui.find({ key: 'pan-left' })).toBeUndefined() // nothing to pan at fit

  await ui.press({ key: 'zoom-in' }) // 125%
  await ui.press({ key: 'zoom-in' }) // 150%
  await ui.press({ key: 'zoom-in' }) // 200%
  const zoomed = await viewBox()
  expect(Math.round(zoomed.w)).toBe(Math.round(fit.w / 2)) // half the width shown, stretched to the pane
  expect((await svg())?.props.width).toBe(undefined) // the image itself is never widened
  expect(await caption()).toContain('zoom 200% · showing 0–50%')
  await ui.press({ key: 'pan-right' })
  expect((await viewBox()).x).toBeGreaterThan(zoomed.x)
  expect(await caption()).toContain('showing 25–75%') // half a screen per press keeps context
  await ui.press({ key: 'pan-right' })
  expect(await caption()).toContain('showing 50–100%')

  await ui.press({ key: 'zoom-fit' })
  expect(Math.round((await viewBox()).w)).toBe(Math.round(fit.w))
  await ui.press({ key: 'zoom-out' }) // 75%: a wider view, so the drawing shrinks
  expect((await viewBox()).w).toBeGreaterThan(fit.w)
  expect(await caption()).toContain('zoom 75%')
  await ui.unmount()
})

test('an agent Edit of an open file redraws only that pane', async ($, on) => {
  const content = serveHost(on)
  on('tool.call', { tool: 'Edit' }, () => ({ result: { ok: true } }))
  await $.command.run({ command: 'diagram', args: 'maps/order.bpmn' })
  const ui = await mount($, 'bpmn')
  content['maps/order.bpmn'] = BPMN.replace('name="Done"', 'name="Shipped"')
  await $.tool.call({ tool: 'Edit', file_path: realOf('maps/order.bpmn'), old_string: 'Done', new_string: 'Shipped' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('Shipped')
  await ui.unmount()
})

test('draw.io: built-in without draw.io; CLI export with it; the other orientation is built-in', async ($, on) => {
  const exports: string[] = []
  serveHost(on, { drawioInstalled: true, exports })
  await $.command.run({ command: 'diagram', args: 'maps/flow chart.drawio Details' })
  const ui = await mount($, 'drawio')
  const caption = async () => (await ui.find({ type: 'Text', text: /source:/ }))?.text ?? 'no caption'
  const note = async () => (await ui.find({ type: 'Text', text: /^Note:/ }))?.text ?? 'no note'
  expect(await caption()).toContain('source: draw.io export')
  expect(exports[0]).toContain('--page-index 2')
  expect(exports[0]).toContain('--output C:\\Temp\\diagram-preview\\')
  await ui.press({ key: 'orientation' }) // → portrait
  expect(await note()).toContain('portrait is drawn by the built-in renderer')
  await ui.press({ key: 'orientation' }) // → landscape
  expect((await ui.find({ key: 'renderer' }))?.props.label).toBe('Use built-in renderer')
  await ui.press({ key: 'renderer' })
  expect(await caption()).toContain('source: built-in renderer')
  expect((await ui.find({ key: 'renderer' }))?.props.label).toBe('Use draw.io export')
  await ui.select({ key: 'page', value: '0' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('Wrapped label')
  await ui.unmount()
})

test('draw.io without draw.io installed says the built-in renderer drew it', async ($, on) => {
  serveHost(on)
  await $.command.run({ command: 'diagram', args: 'maps/flow chart.drawio' })
  const ui = await mount($, 'drawio')
  expect(await ui.find({ type: 'Text', text: /draw.io Desktop is not installed/ })).toBeDefined()
  await ui.unmount()
})

test('excalidraw: a newer plugin export is shown; an older one is ignored with a note', async ($, on) => {
  serveHost(on, { excalidrawExport: 'newer' })
  await $.command.run({ command: 'diagram', args: 'maps/flow.excalidraw.md' })
  const ui = await mount($, 'excalidraw')
  expect(await ui.find({ type: 'Text', text: /source: Excalidraw plugin export/ })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toBe(EXPORTED)
  await ui.unmount()
})

test('excalidraw: an export older than the drawing is ignored, with a note', async ($, on) => {
  serveHost(on, { excalidrawExport: 'older' })
  await $.command.run({ command: 'diagram', args: 'maps/flow.excalidraw.md' })
  const ui = await mount($, 'excalidraw')
  expect(await ui.find({ type: 'Text', text: /source: built-in renderer \(json\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /older than the drawing/ })).toBeDefined()
  await ui.unmount()
})

test('pages: BPMN diagram select, unknown pages and pages on a page-less format', async ($, on) => {
  serveHost(on)
  await $.command.run({ command: 'diagram', args: 'maps/order.bpmn' })
  const ui = await mount($, 'bpmn')
  await ui.select({ key: 'page', value: '1' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('Capture')
  await ui.unmount()
  expect((await $.command.run({ command: 'diagram', args: 'maps/flow chart.drawio 9' })).text)
    .toContain('no page "9"; there are: 1. Overview, 2. Details')
  expect((await $.command.run({ command: 'diagram', args: 'maps/home.canvas 2' })).text).toContain('Canvas files have no pages')
})

test('outside a vault the drawing shows without the Obsidian button; the terminal gets text', async ($, on) => {
  serveHost(on, { inVault: false })
  await $.command.run({ command: 'diagram', args: 'maps/home.canvas' })
  const ui = await mount($, 'canvas')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ key: 'open-obsidian' })).toBeUndefined()
  await ui.unmount()
  const term = await mount($, 'canvas', 'terminal')
  expect(await term.find({ type: 'Text', text: 'maps/home.canvas' })).toBeDefined()
  await term.unmount()
})

test('d2: drawn by the d2 CLI (in WSL), sized from its viewBox, cached across redraws', async ($, on) => {
  const d2Inputs: string[] = []
  serveHost(on, { d2Inputs })
  const ran = await $.command.run({ command: 'diagram', args: 'maps/flow.d2' })
  expect(ran.text).toBe('Showing maps/flow.d2 in the D2 pane.')
  const ui = await mount($, 'd2')
  const caption = async () => (await ui.find({ type: 'Text', text: /source:/ }))?.text ?? 'no caption'
  expect(await caption()).toContain('3 shapes · 2 connections · landscape')
  expect(await caption()).toContain('source: d2')
  expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('width="900" height="300"') // size added from viewBox
  const renders = d2Inputs.length
  await ui.press({ key: 'zoom-in' }) // a redraw that must not run d2 again
  expect(d2Inputs.length).toBe(renders)
  await ui.unmount()
})

test('d2: portrait is a real re-layout with direction: down', async ($, on) => {
  const d2Inputs: string[] = []
  serveHost(on, { d2Inputs })
  await $.command.run({ command: 'diagram', args: 'maps/flow.d2' })
  const ui = await mount($, 'd2')
  await ui.press({ key: 'orientation' })
  const last = d2Inputs[d2Inputs.length - 1] ?? ''
  expect(last.startsWith('direction: down\n')).toBe(true)
  expect(last).not.toContain('direction: right') // the file's own root direction was replaced
  const size = sizeOf((await ui.find({ type: 'Svg' }))?.props.source)
  expect(size.h).toBeGreaterThan(size.w)
  expect((await ui.find({ type: 'Text', text: /source:/ }))?.text).toContain('source: d2, direction: down')
  await ui.unmount()
})

test('d2: a compile error and a missing d2 are both explained in the pane', async ($, on) => {
  serveHost(on, { content: { ...FILES, 'maps/broken.d2': 'a -> {\n' } })
  await $.command.run({ command: 'diagram', args: 'maps/broken.d2' })
  const ui = await mount($, 'd2')
  expect((await ui.find({ type: 'Text', text: /Cannot draw/ }))?.text).toContain('d2 could not compile it: failed to compile')
  await ui.unmount()
})

test('d2: without d2 installed the pane says where it looked', async ($, on) => {
  serveHost(on, { d2: 'missing' })
  await $.command.run({ command: 'diagram', args: 'maps/flow.d2' })
  const ui = await mount($, 'd2')
  expect((await ui.find({ type: 'Text', text: /Cannot draw/ }))?.text).toContain('d2 is not installed (looked on the PATH and inside WSL)')
  await ui.unmount()
})

test('a file the mod does not draw is refused with the formats it does', async $ => {
  const ran = await $.command.run({ command: 'diagram', args: 'notes/a.md' })
  expect(ran.text).toContain('is not a diagram this mod draws (.canvas, .excalidraw.md, .excalidraw, .drawio, .bpmn, .d2)')
})
