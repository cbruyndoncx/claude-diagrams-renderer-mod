import { memberOf, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiagramTarget } from '../types'
import {
  SVG_LIMIT,
  asOrientation,
  cleanArg,
  errorText,
  launchers,
  obsidianUri,
  orientationOf,
  panStep,
  parentOf,
  samePath,
  sepOf,
  stepZoom,
  stripFonts,
  targetIn,
  tooLargeMessage,
  withSize,
  zoomLabel,
  zoomView,
} from './common'
import type { Orientation, Target } from './common'
import {
  ALL_EXTS,
  FORMATS,
  FORMAT_INFO,
  describeD2,
  displayName,
  formatOf,
  pageIndex,
  parseArgs,
  renderBuiltin,
  withD2Direction,
} from './formats/index'
import type { Format } from './formats/index'

/** One target per format, keyed by the pane's id (which is the format's name). */
const TARGET = { plugin: 'diagram-preview', key: 'target' } as const

type Drawn = {
  svg: string
  summary: string
  source: string
  orientation: Orientation
  pages?: string[]
  note?: string
}

// ── files ────────────────────────────────────────────────────────────────

/** Resolve a typed path; the vault is the nearest folder above it holding `.obsidian`. */
async function resolveTarget($: EngineInterface, path: string): Promise<Target | { error: string }> {
  const clean = cleanArg(path)
  if (!clean) return { error: `give a path to a diagram (${ALL_EXTS.join(', ')})` }
  if (!formatOf(clean)) return { error: `${clean} is not a diagram this mod draws (${ALL_EXTS.join(', ')})` }
  const stat = await $.fs.stat(clean, { resolve: true }).catch(() => undefined)
  if (!stat || stat.kind !== 'file' || !stat.realPath) return { error: `${clean} not found` }
  const real = stat.realPath
  for (let dir = parentOf(real); dir; dir = parentOf(dir)) {
    if (await $.fs.exists(`${dir}${sepOf(real)}.obsidian`).catch(() => false)) return targetIn(dir, real)
  }
  return { rel: clean.replace(/\\/g, '/'), real, rev: 0 }
}

async function openInObsidian($: EngineInterface, target: Target): Promise<string> {
  const uri = obsidianUri(target)
  if (!uri) throw new Error('the file is not inside an Obsidian vault (no .obsidian folder above it)')
  let last = 'no launcher available'
  for (const argv of launchers(uri)) {
    try {
      const run = await $.process.run(argv, { timeoutMs: 15000 })
      if (run.exitCode === 0) return argv[0] ?? 'launcher'
      last = `${argv[0]} exited ${run.exitCode}: ${run.stderr.trim().slice(0, 200)}`
    } catch (err) {
      last = `${argv[0]}: ${errorText(err)}`
    }
  }
  throw new Error(last)
}

// ── external renderers (fixed pictures, natural orientation only) ────────

/** The Excalidraw plugin's auto-export: `x.excalidraw.md` → `x.excalidraw.svg`. */
function excalidrawExportPath(real: string): string {
  return `${real.slice(0, real.lastIndexOf('.'))}.svg`
}

async function excalidrawExport($: EngineInterface, real: string): Promise<{ svg?: string; note?: string }> {
  const exported = excalidrawExportPath(real)
  const [drawing, svgStat] = await Promise.all([$.fs.stat(real), $.fs.stat(exported).catch(() => undefined)])
  if (!svgStat || svgStat.kind !== 'file') return {}
  if (svgStat.mtimeMs < drawing.mtimeMs) return { note: 'the plugin export is older than the drawing' }
  const svg = (await $.fs.read(exported)).replace(/^[\s\S]*?(<svg[\s>])/, '$1')
  if (!svg.startsWith('<svg')) return { note: 'the plugin export is not an SVG' }
  if (svg.length > SVG_LIMIT) return { note: 'the plugin export is too large for the pane' }
  return { svg }
}

/** Where draw.io Desktop installs on Windows and macOS; `drawio` on PATH elsewhere. */
async function findDrawio($: EngineInterface): Promise<string | undefined> {
  const programFiles = await $.env.get('ProgramFiles')
  const localAppData = await $.env.get('LOCALAPPDATA')
  const candidates = [
    programFiles && `${programFiles}\\draw.io\\draw.io.exe`,
    localAppData && `${localAppData}\\Programs\\draw.io\\draw.io.exe`,
    '/Applications/draw.io.app/Contents/MacOS/draw.io',
    '/usr/bin/drawio',
    '/snap/bin/drawio',
  ].filter((p): p is string => !!p)
  for (const path of candidates) {
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return undefined
}

/** Export one draw.io page with its CLI into a temp folder; reuse a newer export. */
async function drawioExport($: EngineInterface, exe: string, real: string, page: number): Promise<string> {
  const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  const sep = sepOf(temp)
  const key = Array.from(real).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
  const out = `${temp.replace(/[\\/]$/, '')}${sep}diagram-preview${sep}${(key >>> 0).toString(16)}-p${page}.svg`
  const [source, cached] = await Promise.all([$.fs.stat(real), $.fs.stat(out).catch(() => undefined)])
  if (!cached || cached.mtimeMs < source.mtimeMs) {
    // --page-index is 1-based in the draw.io Desktop CLI.
    const run = await $.process.run(
      [exe, '--export', '--format', 'svg', '--page-index', String(page + 1), '--output', out, real],
      { timeoutMs: 60000 },
    )
    if (run.exitCode !== 0) throw new Error(`draw.io export exited ${run.exitCode}: ${run.stderr.trim().slice(0, 200)}`)
  }
  return (await $.fs.read(out)).replace(/^[\s\S]*?(<svg[\s>])/, '$1')
}

// ── D2 (the d2 CLI is its layout engine) ─────────────────────────────────

/**
 * Rendered D2 SVGs by file, modification time and direction. A render costs seconds (most
 * of it starting WSL), and every zoom or pan press redraws the pane. A module variable is
 * enough: a reload only costs one fresh render.
 */
const d2Cache = new Map<string, string>()

/** d2 on the PATH first (macOS, Linux, a Windows install), then the copy inside WSL. */
const D2_COMMANDS: string[][] = [
  ['d2', '--pad', '20', '-', '-'],
  ['wsl.exe', '-e', 'bash', '-lc', 'd2 --pad 20 - -'],
]

async function renderD2($: EngineInterface, real: string, source: string, direction?: 'right' | 'down'): Promise<string> {
  const stat = await $.fs.stat(real)
  const key = `${real}|${stat.mtimeMs}|${direction ?? 'natural'}`
  const cached = d2Cache.get(key)
  if (cached) return cached
  const input = direction ? withD2Direction(source, direction) : source
  for (const argv of D2_COMMANDS) {
    let run
    try {
      run = await $.process.run(argv, { stdin: input, timeoutMs: 60000 })
    } catch {
      continue // not installed this way; try the next
    }
    const errors = run.stderr.split('\n').filter(line => line.startsWith('err:'))
    if (errors.length) throw new Error(`d2 could not compile it: ${errors.slice(0, 3).map(l => l.slice(4).trim()).join('; ')}`)
    const at = run.stdout.indexOf('<svg')
    if (run.exitCode !== 0 || at < 0) continue // e.g. bash: d2: command not found (127)
    let svg = withSize(run.stdout.slice(at))
    if (svg.length > SVG_LIMIT) svg = stripFonts(svg)
    d2Cache.set(key, svg)
    return svg
  }
  throw new Error('d2 is not installed (looked on the PATH and inside WSL); see https://d2lang.com')
}

// ── drawing ──────────────────────────────────────────────────────────────

/**
 * Draw a target. An external picture (the Excalidraw plugin's export, draw.io's CLI
 * export) is used when it exists and is in the orientation asked for; the other
 * orientation is always the built-in renderer's transposed layout.
 */
async function draw($: EngineInterface, t: DiagramTarget): Promise<Drawn> {
  const source = await $.fs.read(t.real)

  if (t.format === 'd2') {
    // D2 lays the diagram out itself, so the other orientation is a real re-layout:
    // the root `direction` set to `down` (portrait) or `right` (landscape).
    const natural = await renderD2($, t.real, source)
    const naturalOrientation = orientationOf(natural)
    if (t.orientation && t.orientation !== naturalOrientation) {
      const direction = t.orientation === 'portrait' ? 'down' : 'right'
      const turned = await renderD2($, t.real, source, direction)
      return { svg: turned, summary: describeD2(turned), source: `d2, direction: ${direction}`, orientation: orientationOf(turned) }
    }
    return { svg: natural, summary: describeD2(natural), source: 'd2', orientation: naturalOrientation }
  }

  const builtin = await renderBuiltin(t.format, source, t.page, false)
  let svg = builtin.svg
  let from = builtin.detail ? `built-in renderer (${builtin.detail})` : 'built-in renderer'
  let note: string | undefined
  let external = false

  if (t.format === 'excalidraw') {
    const exported = await excalidrawExport($, t.real)
    note = exported.note
    if (exported.svg) {
      svg = exported.svg
      from = 'Excalidraw plugin export'
      external = true
    }
  } else if (t.format === 'drawio' && t.prefer === 'auto') {
    const exe = await findDrawio($)
    if (!exe) {
      note = 'draw.io Desktop is not installed, so the built-in renderer drew this'
    } else {
      try {
        const exported = await drawioExport($, exe, t.real, t.page)
        if (exported.length <= SVG_LIMIT) {
          svg = exported
          from = `draw.io export${exported.includes('<foreignObject') ? ' (HTML labels)' : ''}`
          external = true
        } else {
          note = 'the draw.io export is too large for the pane'
        }
      } catch (err) {
        note = `draw.io export failed (${errorText(err)})`
      }
    }
  }

  const natural = orientationOf(svg)
  if (t.orientation && t.orientation !== natural) {
    // The layout swap keeps shape sizes so labels still fit; when very wide (or tall)
    // shapes keep the drawing in its natural orientation, swap every size as well.
    let turned = await renderBuiltin(t.format, source, t.page, true)
    let how = 'transposed'
    if (orientationOf(turned.svg) !== t.orientation) {
      turned = await renderBuiltin(t.format, source, t.page, 'swap')
      how = 'transposed, shapes turned'
    }
    return {
      svg: turned.svg,
      summary: turned.summary,
      source: `built-in renderer, ${how}`,
      orientation: orientationOf(turned.svg),
      pages: turned.pages,
      note: external ? `${t.orientation} is drawn by the built-in renderer; the ${from} is a fixed picture` : note,
    }
  }
  return { svg, summary: builtin.summary, source: from, orientation: natural, pages: builtin.pages, note }
}

async function show(
  $: EngineInterface,
  args: string,
  opts: { page?: string; orientation?: Orientation } = {},
): Promise<string> {
  const parsed = parseArgs(args)
  const target = await resolveTarget($, parsed.path)
  if ('error' in target) return `diagram-preview: ${target.error}`
  const format = formatOf(target.real) as Format
  const page = pageIndex(await $.fs.read(target.real), format, opts.page ?? parsed.page)
  if (typeof page !== 'number') return `diagram-preview: ${target.rel}: ${page.error}`
  const orientation = opts.orientation ?? parsed.orientation
  const value: DiagramTarget = { ...target, format, rev: Date.now(), page, zoom: 1, pan: 0, prefer: 'auto' }
  if (orientation) value.orientation = orientation
  await $.state.set({ ...TARGET, id: format }, value)
  // Opening an open pane only retitles it, behind whichever tab is in front: close it
  // first so the new file always lands in front.
  const isOpen = await $.ui.panes().then(ps => ps.some(p => p.id === format)).catch(() => false)
  if (isOpen) await $.ui.close({ id: format }).catch(() => undefined)
  const opened = await $.ui.open({ id: format, title: `${FORMAT_INFO[format].label} · ${displayName(target.rel, format)}`, focus: true })
  const extra = [page > 0 ? `page ${page + 1}` : '', orientation ?? ''].filter(Boolean).join(', ')
  return opened.isPlaced
    ? `Showing ${target.rel}${extra ? ` (${extra})` : ''} in the ${FORMAT_INFO[format].label} pane.`
    : `The ${FORMAT_INFO[format].label} pane holds ${target.rel} but is not placed yet (${opened.reason}).`
}

// ── hooks ────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'diagram',
      description: 'Show a vault diagram (.canvas, .excalidraw.md, .drawio, .bpmn, .d2) in a side pane',
      argumentHint: '<path> [page] [--landscape|--portrait]',
    })
    await $.tool.register({
      name: 'open',
      description:
        "Open a diagram from the Obsidian vault in the person's side pane, rendered from the file: " +
        'JSON Canvas (.canvas), Excalidraw (.excalidraw.md), draw.io (.drawio), BPMN 2.0 (.bpmn) or D2 (.d2). ' +
        'The pane refreshes by itself after you Write or Edit that file. Optional: page (1-based ' +
        'number or name, for draw.io pages and BPMN diagrams) and orientation (landscape or ' +
        'portrait; the other orientation than the drawing natural one draws its transposed layout).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Vault-relative or absolute path to the diagram' },
          page: { type: 'string', description: 'Optional page or diagram: 1-based number or name' },
          orientation: { type: 'string', enum: ['landscape', 'portrait'], description: 'Optional orientation' },
        },
        required: ['path'],
      },
    })
    return next(e)
  })

  on('command.run', { command: 'diagram' }, async ($, e) => ({ text: await show($, e.args) }))

  on('tool.call', { tool: 'mcp__diagram-preview__open' }, async ($, e) => ({
    result: await show($, `"${String(e.path ?? '')}"`, {
      page: e.page === undefined ? undefined : String(e.page),
      orientation: asOrientation(e.orientation),
    }),
  }))

  // Refresh a pane after the agent writes the file it shows (or an Excalidraw export of it).
  for (const tool of ['Write', 'Edit'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError) return ran
      const path = String(e.file_path ?? '')
      for (const format of FORMATS) {
        const ref = { ...TARGET, id: format }
        const { value } = await $.state.get(ref)
        if (value && (samePath(path, value.real) || (format === 'excalidraw' && samePath(path, excalidrawExportPath(value.real))))) {
          await update($, ref, cur => (cur ? { ...cur, rev: cur.rev + 1 } : cur))
        }
      }
      return ran
    })
  }

  for (const format of FORMATS) {
    on('ui.render', { component: 'Pane', requestId: format }, async ($, e) => {
      const ref = memberOf(TARGET, e)
      const { value: t } = await $.state.get(ref)
      const patch = (change: Partial<DiagramTarget>) =>
        update($, ref, cur => (cur ? { ...cur, ...change, rev: cur.rev + 1 } : cur))
      const obsidian = async () => {
        if (!t) return
        try {
          $.ui.toast(`Opened ${t.rel} in Obsidian (${await openInObsidian($, t)})`)
        } catch (err) {
          $.ui.toast(`Could not open Obsidian: ${errorText(err)}`)
        }
      }
      const empty = `No ${FORMAT_INFO[format].label} diagram open. Run /diagram with a path.`

      if (e.surface === 'terminal') {
        const { Box, Text, Button } = $.ui.resolve(e)
        return (
          <Box flexDirection="column">
            <Text>{t ? t.rel : empty}</Text>
            <Text dimColor>The terminal cannot draw SVG; use the Desktop Code tab, or open it in Obsidian.</Text>
            {t?.vault && <Button key="open-obsidian" label="Open in Obsidian" onPress={obsidian} />}
          </Box>
        )
      }

      const elements = $.ui.resolve(e)
      const { Box, Text, Button, Svg } = elements
      const Select = 'Select' in elements ? elements.Select : undefined // the mobile app draws no Select
      if (!t) return <Text dimColor>{empty}</Text>

      let drawn: Drawn | undefined
      let failure: string | undefined
      try {
        drawn = await draw($, t)
      } catch (err) {
        failure = errorText(err)
      }
      const zoom = t.zoom > 0 ? t.zoom : 1
      const pan = t.pan ?? 0
      const view = drawn ? zoomView(drawn.svg, zoom, pan) : undefined
      const zoomTo = (direction: 1 | -1) => patch({ zoom: stepZoom(zoom, direction) })
      const panBy = (direction: 1 | -1) => patch({ pan: Math.min(1, Math.max(0, pan + direction * panStep(zoom))) })
      const orientation = drawn?.orientation ?? t.orientation ?? 'landscape'
      const pageWord = FORMAT_INFO[format].pageWord
      const caption = drawn && view
        ? [drawn.summary, orientation, zoomLabel(zoom, view.from, view.to), `source: ${drawn.source}`].filter(Boolean).join(' · ')
        : ''

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold wrap="truncate-middle">{t.rel}</Text>
          <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
            {/* One press switches orientation; the label says what the press does, the caption
                says what is shown. A dropdown for two values was one click too many. */}
            <Button
              key="orientation"
              label={orientation === 'landscape' ? 'Switch to portrait' : 'Switch to landscape'}
              onPress={() => patch({ orientation: orientation === 'landscape' ? 'portrait' : 'landscape' })}
            />
            <Button key="zoom-out" label="−" onPress={() => zoomTo(-1)} />
            <Button key="zoom-fit" label="Fit" onPress={() => patch({ zoom: 1, pan: 0 })} />
            <Button key="zoom-in" label="+" onPress={() => zoomTo(1)} />
            {zoom > 1 && <Button key="pan-left" label="◀" onPress={() => panBy(-1)} />}
            {zoom > 1 && <Button key="pan-right" label="▶" onPress={() => panBy(1)} />}
            <Button key="refresh" label="Refresh" onPress={() => patch({})} />
            {t.vault && <Button key="open-obsidian" label="Open in Obsidian" variant="primary" onPress={obsidian} />}
          </Box>
          {Select && pageWord && (drawn?.pages?.length ?? 0) > 1 && (
            <Select
              key="page"
              label={pageWord}
              value={String(Math.min(t.page, (drawn?.pages?.length ?? 1) - 1))}
              options={(drawn?.pages ?? []).map((name, i) => ({ value: String(i), label: `${i + 1}. ${name}` }))}
              onSelect={value => patch({ page: Number(value) })}
            />
          )}
          {format === 'drawio' && (
            <Button
              key="renderer"
              label={t.prefer === 'auto' ? 'Use built-in renderer' : 'Use draw.io export'}
              onPress={() => patch({ prefer: t.prefer === 'auto' ? 'builtin' : 'auto' })}
            />
          )}
          {caption && <Text dimColor>{caption}</Text>}
          {drawn?.note && <Text dimColor italic>Note: {drawn.note}.</Text>}
          {failure && <Text color="red">Cannot draw {t.rel}: {failure}</Text>}
          {drawn && view && (view.svg.length > SVG_LIMIT ? (
            <Text>{tooLargeMessage(view.svg.length)}</Text>
          ) : (
            <Svg source={view.svg} alt={`${FORMAT_INFO[format].label} diagram ${t.rel}: ${drawn.summary}`} />
          ))}
        </Box>
      )
    })
  }
}
