// Every setting of the symbiote, in one list: the Symbiote tab draws its
// sliders from it, and the timeline uses it for keys.

export interface Symbiote {
  on: boolean
  // look
  shader?: 'wet' | 'oily' | 'flesh' | 'own'
  color?: string; shine?: string
  gloss?: number; shineAmount?: number; coat?: number
  // veins
  veinsOn?: boolean
  veins?: string; veins2?: string
  veinAmount?: number; veinWidth?: number; veinBulge?: number; veinDepth?: number; veinGlow?: number
  throb?: number; throbRate?: number; veinTendrils?: number
  // body
  blob?: number; self?: number; crawl?: number; bumps?: number; lumpSize?: number; swell?: number; breathe?: number
  // tendrils
  reach: number; arms: number; maxArms?: number; thick: number; sizeVar?: number
  goo: number; rootSize?: number; strands?: number; latch?: number; lunge?: number; grip?: number
  // holding
  gravity?: number; holdMotion?: number
  // stretching
  web?: number; thin?: number; strings?: number
  // snapping
  detach: number; detachVar?: number; recoil?: number; curl?: number; whipSnap?: number; leftover?: number; snapStrings?: number
  // drips
  drips?: number; dripSize?: number; dripGravity?: number
  puddle?: 'stay' | 'fade'; puddleTime?: number; puddleSpread?: number
  // all
  speed: number; detail?: number
  look?: 'venom' | 'carnage' | 'white' | 'own'   // older scenes
}

export const SYMBIOTE_DEFAULT: Required<Omit<Symbiote, 'look'>> = {
  on: true,
  shader: 'wet', color: '#060608', shine: '#3a4c78', gloss: 0.83, shineAmount: 0.35, coat: 1,
  veinsOn: false, veins: '#2f8f3a', veins2: '#1d6b4a', veinAmount: 0.5, veinWidth: 0.5, veinBulge: 0.5, veinDepth: 0.55, veinGlow: 0, throb: 0.6, throbRate: 1.1, veinTendrils: 0.6,
  blob: 0.5, self: 0.5, crawl: 1, bumps: 0.4, lumpSize: 1, swell: 0.5, breathe: 0.3,
  reach: 1.2, arms: 8, maxArms: 28, thick: 0.05, sizeVar: 0.7, goo: 0.6, rootSize: 1, strands: 2, latch: 1, lunge: 0.6, grip: 0.6,
  gravity: 0.35, holdMotion: 0.3,
  web: 0.6, thin: 0.85, strings: 0.6,
  detach: 2.4, detachVar: 0.3, recoil: 1, curl: 0.6, whipSnap: 0.6, leftover: 0.5, snapStrings: 0.6,
  drips: 0.5, dripSize: 1, dripGravity: 1, puddle: 'fade', puddleTime: 6, puddleSpread: 1,
  speed: 1, detail: 56,
}

export type SymNumKey = { [K in keyof Symbiote]-?: Required<Symbiote>[K] extends number ? K : never }[keyof Symbiote]
export interface SymNum { key: SymNumKey; label: string; group: string; min: number; max: number; step?: number; keyable?: boolean }

export const SYM_GROUPS = ['Look', 'Veins', 'Body', 'Tendrils', 'Holding', 'Stretching', 'Snapping', 'Drips', 'Quality'] as const

export const SYM_NUMS: SymNum[] = [
  { key: 'gloss', label: 'Gloss (wet and sharp, or soft)', group: 'Look', min: 0, max: 1, keyable: true },
  { key: 'shineAmount', label: 'Shine at the edges', group: 'Look', min: 0, max: 1, keyable: true },
  { key: 'coat', label: 'Wet coat on top', group: 'Look', min: 0, max: 1, keyable: true },

  { key: 'veinAmount', label: 'How many veins', group: 'Veins', min: 0, max: 1, keyable: true },
  { key: 'veinWidth', label: 'Vein width', group: 'Veins', min: 0.05, max: 1, keyable: true },
  { key: 'veinBulge', label: 'Bulge (how much they push the skin out)', group: 'Veins', min: 0, max: 1, keyable: true },
  { key: 'veinDepth', label: 'Under the skin (0 on top, 1 deep and soft)', group: 'Veins', min: 0, max: 1, keyable: true },
  { key: 'veinGlow', label: 'Glow', group: 'Veins', min: 0, max: 2, keyable: true },
  { key: 'throb', label: 'Throb (how strong each beat is)', group: 'Veins', min: 0, max: 1, keyable: true },
  { key: 'throbRate', label: 'Beats each second', group: 'Veins', min: 0.1, max: 4, keyable: true },
  { key: 'veinTendrils', label: 'Veins on the tendrils', group: 'Veins', min: 0, max: 1, keyable: true },

  { key: 'blob', label: 'Blob (0 keeps the shape, 1 a round blob)', group: 'Body', min: 0, max: 1 },
  { key: 'self', label: 'Alive (how much the skin crawls and swells)', group: 'Body', min: 0, max: 1, keyable: true },
  { key: 'crawl', label: 'Crawl speed', group: 'Body', min: 0, max: 4, keyable: true },
  { key: 'bumps', label: 'Lumps and ridges', group: 'Body', min: 0, max: 1, keyable: true },
  { key: 'lumpSize', label: 'Lump size', group: 'Body', min: 0.3, max: 3, keyable: true },
  { key: 'swell', label: 'Swells toward things near it', group: 'Body', min: 0, max: 1, keyable: true },
  { key: 'breathe', label: 'Breathing', group: 'Body', min: 0, max: 1, keyable: true },

  { key: 'reach', label: 'Reach (grows toward things closer than this)', group: 'Tendrils', min: 0.05, max: 10, keyable: true },
  { key: 'arms', label: 'Tendrils for each thing', group: 'Tendrils', min: 1, max: 24, step: 1 },
  { key: 'maxArms', label: 'Most tendrils at once', group: 'Tendrils', min: 1, max: 60, step: 1 },
  { key: 'thick', label: 'Thickness', group: 'Tendrils', min: 0.005, max: 0.5, step: 0.005, keyable: true },
  { key: 'sizeVar', label: 'Size mix (a few thick ones, many thin ones)', group: 'Tendrils', min: 0, max: 1, keyable: true },
  { key: 'rootSize', label: 'Root size (where they leave the body)', group: 'Tendrils', min: 0.2, max: 3, keyable: true },
  { key: 'goo', label: 'Goo (how soft the roots melt into the skin)', group: 'Tendrils', min: 0, max: 1, keyable: true },
  { key: 'strands', label: 'Strands in each bundle', group: 'Tendrils', min: 0, max: 6, step: 1 },
  { key: 'latch', label: 'Latch speed', group: 'Tendrils', min: 0.1, max: 6, keyable: true },
  { key: 'lunge', label: 'Lunge (how much they whip on the way)', group: 'Tendrils', min: 0, max: 1, keyable: true },
  { key: 'grip', label: 'Grip (how wide they spread where they hold)', group: 'Tendrils', min: 0, max: 1, keyable: true },

  { key: 'gravity', label: 'Gravity (how much they droop)', group: 'Holding', min: 0, max: 1.5, keyable: true },
  { key: 'holdMotion', label: 'Writhe while holding', group: 'Holding', min: 0, max: 1, keyable: true },

  { key: 'web', label: 'Web (strands pull apart)', group: 'Stretching', min: 0, max: 1, keyable: true },
  { key: 'thin', label: 'Thinning in the middle', group: 'Stretching', min: 0, max: 1, keyable: true },
  { key: 'strings', label: 'Strings (more thin strings appear)', group: 'Stretching', min: 0, max: 1, keyable: true },

  { key: 'detach', label: 'Let go (snaps past this)', group: 'Snapping', min: 0.1, max: 20, keyable: true },
  { key: 'detachVar', label: 'Let go mix (they snap one by one)', group: 'Snapping', min: 0, max: 1 },
  { key: 'recoil', label: 'Recoil speed', group: 'Snapping', min: 0.1, max: 4, keyable: true },
  { key: 'curl', label: 'Curl (the loose end curls up)', group: 'Snapping', min: 0, max: 1, keyable: true },
  { key: 'whipSnap', label: 'Whip', group: 'Snapping', min: 0, max: 1, keyable: true },
  { key: 'snapStrings', label: 'Last strings (thin threads that hold a moment longer)', group: 'Snapping', min: 0, max: 1, keyable: true },
  { key: 'leftover', label: 'Piece left on the other thing', group: 'Snapping', min: 0, max: 1, keyable: true },

  { key: 'drips', label: 'Drips', group: 'Drips', min: 0, max: 1, keyable: true },
  { key: 'dripSize', label: 'Drip size', group: 'Drips', min: 0.2, max: 3, keyable: true },
  { key: 'dripGravity', label: 'Drip gravity', group: 'Drips', min: 0, max: 3, keyable: true },
  { key: 'puddleSpread', label: 'Puddle spread', group: 'Drips', min: 0, max: 3, keyable: true },
  { key: 'puddleTime', label: 'Fade after (seconds)', group: 'Drips', min: 0.5, max: 60, step: 0.5 },

  { key: 'speed', label: 'Speed of everything', group: 'Quality', min: 0.05, max: 6, keyable: true },
  { key: 'detail', label: 'Detail (smoother, slower)', group: 'Quality', min: 28, max: 88, step: 1 },
]

/** The settings of an object's symbiote, with older scenes read the new way. */
export function symOf(sy: Partial<Symbiote> | undefined): Required<Omit<Symbiote, 'look'>> {
  const out = { ...SYMBIOTE_DEFAULT, ...(sy ?? {}) } as Required<Omit<Symbiote, 'look'>> & { look?: string; shader: string }
  if (sy && sy.color === undefined && sy.look) out.color = ({ venom: '#060608', carnage: '#6a0508', white: '#e8e8ec' } as Record<string, string>)[sy.look] ?? out.color
  if (sy?.look === 'own' && sy.shader === undefined) out.shader = 'own'
  if ((sy?.shader as string) === 'veins') { out.shader = 'wet'; if (sy?.veinsOn === undefined) out.veinsOn = true }
  return out as Required<Omit<Symbiote, 'look'>>
}
