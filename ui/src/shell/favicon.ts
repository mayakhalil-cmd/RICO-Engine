// The tab icon: the pixel R from the app icon with a blinking cursor in the
// accent color. It follows the color theme and stops blinking with Less motion.

const R = [
  '#########..',
  '##########.',
  '##.....####',
  '##.......##',
  '##.......##',
  '##......###',
  '##########.',
  '#########..',
  '##....###..',
  '##.....###.',
  '##......###',
  '##.......##',
]

let timer = 0
let accent = '#3bff03'
let calm = false

function draw(ctx: CanvasRenderingContext2D, link: HTMLLinkElement, on: boolean, glitch: boolean) {
  const S = 64
  ctx.clearRect(0, 0, S, S)
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.roundRect(0, 0, S, S, 12)
  ctx.fill()
  // a little room on the sides: the R and its cursor take about 70% of the width
  const cell = 2.05
  const x0 = (S - 22 * cell) / 2, y0 = (S - 12 * cell) / 2
  const paint = (dx: number, color: string) => {
    ctx.fillStyle = color
    R.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x0 + dx + c * cell, y0 + r * cell, cell + 0.2, cell + 0.2)
    })
  }
  if (glitch) {
    // a quick color split now and then, like the logo on the website
    paint(-1.6, '#002cf8')
    paint(1.6, '#f820a0')
  }
  paint(0, '#ffffff')
  if (on) {
    ctx.fillStyle = accent
    ctx.fillRect(x0 + 13 * cell, y0 + 10 * cell, 9 * cell, 2 * cell)
  }
  link.href = ctx.canvas.toDataURL('image/png')
}

export function startFavicon() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove())
  const link = document.createElement('link')
  link.rel = 'icon'
  link.type = 'image/png'
  document.head.appendChild(link)

  let frame = 0
  const tick = () => {
    frame++
    if (calm) return draw(ctx, link, true, false)
    const on = frame % 8 < 4                   // blink about once a second
    const glitch = frame % 47 === 0 || frame % 47 === 1
    draw(ctx, link, on, glitch)
  }
  tick()
  window.clearInterval(timer)
  timer = window.setInterval(tick, 130)
}

export function setFaviconStyle(color: string, lessMotion: boolean) {
  accent = color
  calm = lessMotion
}
