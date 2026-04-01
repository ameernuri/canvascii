const CANVAS_NAME_ADJECTIVES = [
  'amber',
  'apricot',
  'azure',
  'brisk',
  'cinder',
  'copper',
  'cosmic',
  'cozy',
  'crisp',
  'drift',
  'dune',
  'ember',
  'fern',
  'fizzy',
  'gentle',
  'glossy',
  'golden',
  'harbor',
  'honey',
  'jolly',
  'lilac',
  'lunar',
  'maple',
  'mellow',
  'mint',
  'misty',
  'mossy',
  'nimble',
  'opal',
  'pebble',
  'pepper',
  'playful',
  'savory',
  'sienna',
  'silky',
  'silver',
  'sprout',
  'sunny',
  'tidy',
  'velvet',
  'warm',
  'willow',
  'witty',
]

const CANVAS_NAME_NOUNS = [
  'aurora',
  'berry',
  'bloom',
  'breeze',
  'brook',
  'button',
  'cedar',
  'cloud',
  'comet',
  'delta',
  'echo',
  'field',
  'firefly',
  'fjord',
  'flame',
  'flower',
  'forest',
  'glade',
  'grove',
  'harvest',
  'hill',
  'lantern',
  'meadow',
  'mesa',
  'moon',
  'peak',
  'pine',
  'reef',
  'ridge',
  'river',
  'snow',
  'spark',
  'spruce',
  'star',
  'stone',
  'stream',
  'summit',
  'thicket',
  'trail',
  'wave',
  'whisper',
  'wind',
]

const GENERIC_CANVAS_TITLE_PATTERNS = [
  /^untitled(?: canvas)?$/i,
  /^page \d+$/i,
  /^new page$/i,
  /^diagram \d+$/i,
  /^new diagram$/i,
  /^new canvas$/i,
]

function normalizeTitle(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isGenericCanvasTitle(value) {
  const title = String(value ?? '').trim()
  if (!title) return true
  return GENERIC_CANVAS_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

export function createUniqueCanvasName(existingNames = [], options = {}) {
  const taken = new Set(existingNames.map(normalizeTitle).filter(Boolean))
  const random = typeof options.random === 'function' ? options.random : Math.random

  for (let attempt = 0; attempt < 256; attempt += 1) {
    const adjective = CANVAS_NAME_ADJECTIVES[Math.floor(random() * CANVAS_NAME_ADJECTIVES.length)]
    const noun = CANVAS_NAME_NOUNS[Math.floor(random() * CANVAS_NAME_NOUNS.length)]
    const base = `${adjective}-${noun}`
    if (!taken.has(base)) {
      return base
    }
  }

  const fallbackBase = `${CANVAS_NAME_ADJECTIVES[0]}-${CANVAS_NAME_NOUNS[0]}`
  let suffix = 2
  while (taken.has(`${fallbackBase}-${suffix}`)) {
    suffix += 1
  }
  return `${fallbackBase}-${suffix}`
}
