// Small line icons drawn on a 24px pixel grid, to sit with the pixel titles.

const PATHS: Record<string, string> = {
  home: 'M3 11 12 4l9 7M6 9v11h12V9M10 20v-6h4v6',
  connect: 'M7 4v5M17 4v5M5 9h14v4a7 7 0 0 1-14 0V9ZM12 20v-0M12 17v4',
  route: 'M4 6h5l6 12h5M4 18h5l2-4M15 10l1-4h4M18 3l3 3-3 3M18 15l3 3-3 3',
  create: 'M4 20 14 10M14 10l3-3 3 3-3 3-3-3ZM5 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM17 17l.7 1.3L19 19l-1.3.7L17 21l-.7-1.3L15 19l1.3-.7L17 17Z',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  monitor: 'M3 12h4l2-6 4 12 2-6h6',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  eyeOff: 'M3 3l18 18M10.6 5.1A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6C3.7 8.4 2 12 2 12s4 7 10 7a9 9 0 0 0 5.4-1.6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  play: 'M7 4l13 8-13 8V4Z',
  stop: 'M6 6h12v12H6z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  folder: 'M3 6h6l2 2h10v11H3z',
  dice: 'M4 4h16v16H4zM8.5 8.5h0M15.5 15.5h0M15.5 8.5h0M8.5 15.5h0M12 12h0',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  shy: 'M5 15c2-3 4-4 7-4s5 1 7 4M8 9h0M16 9h0M9 19h6',
  fx: 'M4 19 9 5h4M5 12h6M14 9l6 10M20 9l-6 10',
  solo: 'M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0ZM12 8v0M12 12a3 3 0 1 0 0 0',
  adjust: 'M4 4h16v16H4zM4 20 20 4',
  twirl: 'M9 6l6 6-6 6',
  twirlOpen: 'M6 9l6 6 6-6',
  stopwatch: 'M12 8v5l3 2M9 2h6M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
  keyPrev: 'M15 6l-6 6 6 6',
  keyNext: 'M9 6l6 6-6 6',
  diamond: 'M12 4l8 8-8 8-8-8z',
  null: 'M5 5h14v14H5z',
  parent: 'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 9v4M12 13l-6 6M12 13l6 6',
  mask: 'M4 6h16v12H4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  pen: 'M4 20l4-1L19 8l-3-3L5 16l-1 4ZM14 7l3 3',
  move: 'M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  shape: 'M4 4h8v8H4zM16 20a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  anchor: 'M12 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12 9v11M5 13a7 7 0 0 0 14 0M8 12H5M19 12h-3',
  text: 'M5 5h14M12 5v14M9 19h6',
}

export default function Icon({ name, title }: { name: keyof typeof PATHS | string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? ''} />
    </svg>
  )
}
