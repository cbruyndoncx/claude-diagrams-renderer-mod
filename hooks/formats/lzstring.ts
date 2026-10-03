// LZ-String decompressFromBase64 (pieroxy/lz-string, MIT), the codec the Obsidian
// Excalidraw plugin uses for ```compressed-json drawing blocks. Ported to strict TS.

const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

export function decompressFromBase64(input: string): string | null {
  const clean = input.replace(/\s+/g, '')
  if (!clean) return ''
  const index = new Map<string, number>()
  for (let i = 0; i < KEY.length; i++) index.set(KEY.charAt(i), i)
  return decompress(clean.length, 32, i => index.get(clean.charAt(i)) ?? 0)
}

function decompress(length: number, resetValue: number, next: (i: number) => number): string | null {
  const dictionary: string[] = ['0', '1', '2']
  let enlargeIn = 4
  let dictSize = 4
  let numBits = 3
  const result: string[] = []
  const data = { val: next(0), position: resetValue, index: 1 }

  const readBits = (count: number): number => {
    let bits = 0
    const max = 2 ** count
    let power = 1
    while (power !== max) {
      const bit = data.val & data.position
      data.position >>= 1
      if (data.position === 0) {
        data.position = resetValue
        data.val = next(data.index++)
      }
      bits |= (bit > 0 ? 1 : 0) * power
      power <<= 1
    }
    return bits
  }

  let first: string
  switch (readBits(2)) {
    case 0:
      first = String.fromCharCode(readBits(8))
      break
    case 1:
      first = String.fromCharCode(readBits(16))
      break
    default:
      return ''
  }
  dictionary[3] = first
  let w = first
  result.push(first)

  for (;;) {
    if (data.index > length) return ''
    let code = readBits(numBits)
    if (code === 0 || code === 1) {
      dictionary[dictSize++] = String.fromCharCode(readBits(code === 0 ? 8 : 16))
      code = dictSize - 1
      enlargeIn--
    } else if (code === 2) {
      return result.join('')
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
    let entry: string
    const known = dictionary[code]
    if (known !== undefined) entry = known
    else if (code === dictSize) entry = w + w.charAt(0)
    else return null
    result.push(entry)
    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--
    w = entry
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }
}
