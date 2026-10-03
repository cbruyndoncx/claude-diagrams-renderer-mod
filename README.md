# claude-diagrams-renderer-mod

A [Claude Code](https://claude.com/claude-code) mod that renders diagram files from an
Obsidian vault — or any folder — as SVG in side panes of the **Claude Desktop Code tab**.
Claude Desktop shows Markdown, images and PDFs, but not diagram sources; this fills the gap.

| Format | Extensions | Rendered by |
|---|---|---|
| JSON Canvas (Obsidian) | `.canvas` | built-in renderer |
| Excalidraw (Obsidian plugin) | `.excalidraw.md`, `.excalidraw` | the plugin's own SVG export when newer, else built-in (plain and `compressed-json`) |
| draw.io / diagrams.net | `.drawio` | the draw.io Desktop CLI export when installed, else built-in (multi-page) |
| BPMN 2.0 | `.bpmn` | built-in, from the file's own BPMN DI layout (pools, lanes, tasks, events, gateways, audit colours) |
| D2 | `.d2` | the [`d2`](https://d2lang.com) CLI (on the PATH, or inside WSL) |

Each format opens in its own pane tab, and every tab has the same toolbar:

- **Switch to portrait / Switch to landscape** — one press. A drawing has a natural orientation;
  the other one is drawn as its transposed layout (lanes become columns, arrows still meet box
  edges, text stays horizontal). D2 re-lays the diagram out with `direction: down` / `right`.
- **− · Fit · +** — zoom. The pane always fits an image to its width, so zoom crops the view:
  zoomed in you see a slice of the drawing at full pane width (pan it with **◀ ▶**); zoomed out
  the drawing shrinks inside the pane.
- **Refresh**, and **Open in Obsidian** (via the Advanced URI plugin) when the file is in a vault.
- draw.io adds a page selector and a renderer toggle; BPMN a diagram selector.

The pane redraws by itself after Claude edits the file with Write or Edit.

## Use

- Slash command: `/diagram <path> [page] [--landscape|--portrait]`
- Or just ask Claude ("show me the order-to-cash BPMN in portrait"): the mod registers the
  model tool `mcp__diagram-preview__open` with `path`, `page` and `orientation`.

## Install

This is a *mod*: a plugin of Claude Code function hooks (early access; written against
Claude Code 2.1.286). The plugin is named `diagram-preview`.

1. Clone this repository.
2. Point Claude Desktop at it with `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of your
   **user** settings (`~/.claude/settings.json`; project settings cannot set it), e.g. on
   Windows with the clone inside WSL:

   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "\\\\wsl.localhost\\Ubuntu\\home\\you\\projects\\dev\\claude-diagrams-renderer-mod" } }
   ```

3. Start a new Code-tab session. For live editing, copy the folder into a session's dev-mods
   folder instead (the `plugin-authoring` skill sets that up) — not both at once, or it loads twice.

Optional tools: `d2` for D2 files; [draw.io Desktop](https://www.drawio.com/) for exact draw.io
renders (the built-in renderer covers the rest).

## Develop

```bash
claude plugin validate .
claude plugin test .
```

- `hooks/register.tsx` — the hooks module: command, model tool, panes, toolbar, external renderers.
- `hooks/formats/*.ts` — pure renderers, one per format; `hooks/formats/index.ts` is the registry.
- `hooks/common.ts`, `hooks/xml.ts` — shared pure helpers (orientation, zoom, paths, a DOM-free XML reader).
- `tests/` — 30 tests run by `claude plugin test` against the engine (no real filesystem:
  the tests' hooks serve the files, environment and processes).

The engine only follows `$` (the engine interface) inside the hooks module itself, so every
function that touches files or processes lives in `register.tsx`; everything else is pure.

## Limits

- An SVG may be at most 131,072 characters; larger drawings show a message and the Obsidian button.
- The built-in renderers draw clean shapes, not Excalidraw's hand-drawn style; draw.io stencil
  shapes (C4, P&ID, …) fall back to boxes.
- A plugin or CLI export is a fixed picture: the non-natural orientation is always the built-in renderer.

## Credits

`hooks/formats/lzstring.ts` ports `decompressFromBase64` from
[lz-string](https://github.com/pieroxy/lz-string) by pieroxy (MIT).

## License

[MIT](LICENSE)
