// A minimal, DOM-free XML reader (the mod environment has no DOMParser).
// Same reader as drawio-preview's; each mod ships its own copy.

export type XmlNode = {
  /** Qualified name as written, e.g. `bpmn:task`. */
  name: string
  /** Name without its namespace prefix, e.g. `task`. */
  local: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES[code] ?? whole
  })
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', local: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let last = 0
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const top = stack[stack.length - 1] as XmlNode
    top.text += source.slice(last, m.index)
    last = tag.lastIndex
    if (m[1] !== undefined) {
      top.text += m[1]
      continue
    }
    const name = m[3]
    if (!name) continue // comment or declaration
    if (m[2] === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of (m[4] ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (a[1]) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '')
    }
    const node: XmlNode = { name, local: name.slice(name.indexOf(':') + 1), attrs, children: [], text: '' }
    top.children.push(node)
    if (m[5] !== '/') stack.push(node)
  }
  return root
}

export function walk(node: XmlNode, visit: (n: XmlNode) => void): void {
  for (const child of node.children) {
    visit(child)
    walk(child, visit)
  }
}

export function child(node: XmlNode, local: string): XmlNode | undefined {
  return node.children.find(c => c.local === local)
}
