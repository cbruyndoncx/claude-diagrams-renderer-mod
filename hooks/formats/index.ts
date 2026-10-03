// The format registry: which renderer draws which file, and one pure entry point over all four.
import { parseOrientationFlag } from '../common'
import type { Orientation } from '../common'
import { listDiagrams, diagramToSvg } from './bpmn'
import { canvasToSvg } from './canvas'
import { inflatePage, listPages, pageToSvg } from './drawio'
import { excalidrawToSvg } from './excalidraw'

export type Format = 'canvas' | 'excalidraw' | 'drawio' | 'bpmn' | 'd2'

/** Pane ids double as format names, so each format keeps its own tab. */
export const FORMATS: readonly Format[] = ['canvas', 'excalidraw', 'drawio', 'bpmn', 'd2']

export const FORMAT_INFO: Record<Format, { label: string; exts: readonly string[]; pageWord?: string }> = {
  canvas: { label: 'Canvas', exts: ['.canvas'] },
  excalidraw: { label: 'Excalidraw', exts: ['.excalidraw.md', '.excalidraw'] },
  drawio: { label: 'Draw.io', exts: ['.drawio'], pageWord: 'Page' },
  bpmn: { label: 'BPMN', exts: ['.bpmn'], pageWord: 'Diagram' },
  // D2 has no built-in renderer: its layout engine is the d2 CLI (see register.tsx).
  d2: { label: 'D2', exts: ['.d2'] },
}

/**
 * D2 source with the root layout direction forced: `right` lays it out landscape, `down`
 * portrait. Only top-level `direction:` lines are replaced (nested boards keep theirs).
 */
export function withD2Direction(source: string, direction: 'right' | 'down'): string {
  return `direction: ${direction}\n${source.replace(/^direction\s*:.*$/gm, '')}`
}

/** "12 shapes · 14 connections" from d2's SVG classes. */
export function describeD2(svg: string): string {
  const shapes = (svg.match(/class="shape"/g) ?? []).length
  // A connection is a stroked path (`connection stroke-…`) plus arrowheads (`connection fill-…`).
  const connections = (svg.match(/class="connection stroke-/g) ?? []).length
  return shapes || connections ? `${shapes} shapes · ${connections} connections` : 'D2 diagram'
}

export const ALL_EXTS: readonly string[] = FORMATS.flatMap(f => FORMAT_INFO[f].exts)

export function formatOf(path: string): Format | undefined {
  const lower = path.toLowerCase()
  return FORMATS.find(f => FORMAT_INFO[f].exts.some(ext => lower.endsWith(ext)))
}

/** The name a pane tab shows: the file name without its diagram extension. */
export function displayName(rel: string, format: Format): string {
  const name = rel.split('/').pop() ?? rel
  const ext = FORMAT_INFO[format].exts.find(e => name.toLowerCase().endsWith(e))
  return ext ? name.slice(0, name.length - ext.length) : name
}

/**
 * `<path> [page] [--landscape|--portrait]`: the path may contain spaces or be quoted; a
 * page (number or name) only applies to the multi-page formats, draw.io and BPMN.
 */
export function parseArgs(args: string): { path: string; page?: string; orientation?: Orientation } {
  const { rest, orientation } = parseOrientationFlag(args)
  const exts = ALL_EXTS.map(e => e.replace(/\./g, '\\.')).join('|')
  const m = new RegExp(`^\\s*(["']?)(.*?(?:${exts}))\\1(?:\\s+(.+?))?\\s*$`, 'i').exec(rest)
  return m ? { path: m[2] ?? '', page: m[3], orientation } : { path: rest.trim(), orientation }
}

export type BuiltinRender = {
  svg: string
  /** What the caption says about the drawing, e.g. "21 nodes · 9 edges". */
  summary: string
  /** Page or diagram names, for formats that have several. */
  pages?: string[]
  /** Extra detail for the caption, e.g. "compressed-json". */
  detail?: string
}

function describeBpmn(counts: Record<string, number>): string {
  const sum = (pred: (k: string) => boolean) =>
    Object.entries(counts).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0)
  const parts: [number, string][] = [
    [sum(k => /Task$|^task$|callActivity|subProcess/.test(k)), 'tasks'],
    [sum(k => k.endsWith('Gateway')), 'gateways'],
    [sum(k => k.endsWith('Event')), 'events'],
    [sum(k => k === 'lane'), 'lanes'],
    [sum(k => k.endsWith('Flow')), 'flows'],
  ]
  return parts.filter(([v]) => v > 0).map(([v, label]) => `${v} ${label}`).join(' · ')
}

/**
 * Draw a file with the mod's own renderer for its format. `transpose`: `true` swaps the
 * layout's axes keeping shape sizes; `'swap'` swaps every size too (always turns it).
 */
export async function renderBuiltin(format: Format, source: string, page: number, transpose: boolean | 'swap'): Promise<BuiltinRender> {
  switch (format) {
    case 'canvas': {
      const r = canvasToSvg(source, { transpose })
      return { svg: r.svg, summary: `${r.nodes} nodes · ${r.edges} edges` }
    }
    case 'excalidraw': {
      const r = excalidrawToSvg(source, { transpose })
      const skipped = r.skipped.length ? ` · ${r.skipped.length} shown as placeholders` : ''
      return { svg: r.svg, summary: `${r.elements} elements${skipped}`, detail: r.format }
    }
    case 'drawio': {
      const pages = listPages(source)
      const index = Math.min(Math.max(0, page), pages.length - 1)
      const chosen = pages[index]
      if (!chosen) throw new Error('the file has no pages')
      const r = pageToSvg(await inflatePage(chosen), { transpose })
      return {
        svg: r.svg,
        summary: `page ${index + 1}/${pages.length} · ${r.vertices} shapes · ${r.edges} edges`,
        pages: pages.map(p => p.name),
      }
    }
    case 'bpmn': {
      const r = diagramToSvg(source, page, { transpose })
      return { svg: r.svg, summary: describeBpmn(r.counts), pages: listDiagrams(source).map(d => d.name) }
    }
    case 'd2':
      throw new Error('D2 is drawn by the d2 CLI, not a built-in renderer')
  }
}

/** Resolve a typed page (1-based number or name) against a file's pages. */
export function pageIndex(source: string, format: Format, page: string | undefined): number | { error: string } {
  if (!page) return 0
  if (format !== 'drawio' && format !== 'bpmn') return { error: `${FORMAT_INFO[format].label} files have no pages` }
  const names = format === 'drawio' ? listPages(source).map(p => p.name) : listDiagrams(source).map(d => d.name)
  const asNumber = Number(page)
  const found = Number.isInteger(asNumber) ? asNumber - 1 : names.findIndex(n => n.toLowerCase() === page.toLowerCase())
  if (found < 0 || found >= names.length) {
    return { error: `no ${FORMAT_INFO[format].pageWord?.toLowerCase()} "${page}"; there are: ${names.map((n, i) => `${i + 1}. ${n}`).join(', ')}` }
  }
  return found
}
