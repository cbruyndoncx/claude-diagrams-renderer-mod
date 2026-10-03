export type DiagramTarget = {
  /** Which renderer draws it; also the pane's id. */
  format: 'canvas' | 'excalidraw' | 'drawio' | 'bpmn' | 'd2'
  /** Vault-relative path with forward slashes. */
  rel: string
  /** Resolved absolute path. */
  real: string
  /** Obsidian vault name; absent outside a vault. */
  vault?: string
  /** Bumped on every refresh so the pane redraws. */
  rev: number
  /** Page (draw.io) or diagram (BPMN) shown, 0-based. */
  page: number
  /** Asked-for orientation; absent means the drawing's natural one. */
  orientation?: 'landscape' | 'portrait'
  /** Zoom relative to fitting the pane's width (1 = fit; an older 0 also reads as fit). */
  zoom: number
  /** When zoomed in: where the visible slice sits, 0 = left edge … 1 = right edge. */
  pan?: number
  /** draw.io only: try the draw.io CLI export first, or always the built-in renderer. */
  prefer: 'auto' | 'builtin'
}

declare module 'claude-code' {
  interface PluginState {
    'diagram-preview': { target: StateFamily<DiagramTarget> }
  }
}
