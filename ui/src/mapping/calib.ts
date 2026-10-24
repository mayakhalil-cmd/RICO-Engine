// Projector calibration for 3D mapping: from six or more points on a real
// object (known in the 3D scene) and where they land in the projector
// picture, find where the projector is and how its lens sees (the camera
// matrix). Direct linear transform, then split into lens (K), turn (R) and
// place (t). Same idea as camera calibration in OpenCV or MapMap.

export type V3 = [number, number, number]
export interface Pair { p: V3; uv: [number, number] }          // uv: 0..1 of the projector picture, y down
export interface Solved { K: number[]; R: number[]; t: V3; error: number }  // K, R row-major 3x3; error in pixels

// Smallest eigenvector of a symmetric matrix (Jacobi rotations).
function smallestEigen(A: number[][]): number[] {
  const n = A.length
  const a = A.map((r) => r.slice())
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]
    if (off < 1e-22) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  let best = 0
  for (let i = 1; i < n; i++) if (a[i][i] < a[best][best]) best = i
  return v.map((r) => r[best])
}

const det3 = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
const mul33 = (a: number[], b: number[]) => {
  const o = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}
const tr = (m: number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
export function inv33(m: number[]): number[] {
  const d = det3(m)
  const [a, b, c, d1, e, f, g, h, i] = m
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d1 * i, a * i - c * g, c * d1 - a * f, d1 * h - e * g, b * g - a * h, a * e - b * d1].map((x) => x / d)
}

// QR of a 3x3 (Gram-Schmidt): A = Q R.
function qr(A: number[]): { Q: number[]; R: number[] } {
  const col = (j: number) => [A[j], A[3 + j], A[6 + j]]
  const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  const qs: number[][] = []
  const R = new Array(9).fill(0)
  for (let j = 0; j < 3; j++) {
    let v = col(j)
    for (let i = 0; i < j; i++) {
      const r = dot(qs[i], col(j))
      R[i * 3 + j] = r
      v = v.map((x, k) => x - r * qs[i][k])
    }
    const n = Math.hypot(...v)
    R[j * 3 + j] = n
    qs.push(v.map((x) => x / (n || 1)))
  }
  const Q = [qs[0][0], qs[1][0], qs[2][0], qs[0][1], qs[1][1], qs[2][1], qs[0][2], qs[1][2], qs[2][2]]
  return { Q, R }
}

// RQ: M = K R with K upper triangular and R a rotation.
function rq(M: number[]): { K: number[]; R: number[] } {
  const P = [0, 0, 1, 0, 1, 0, 1, 0, 0]
  const Mp = mul33(P, M)
  const { Q, R } = qr(tr(Mp))
  let K = mul33(mul33(P, tr(R)), P)
  let Rot = mul33(P, tr(Q))
  // Make the lens focal lengths positive.
  const D = [Math.sign(K[0]) || 1, 0, 0, 0, Math.sign(K[4]) || 1, 0, 0, 0, Math.sign(K[8]) || 1]
  K = mul33(K, D)
  Rot = mul33(D, Rot)
  return { K, R: Rot }
}

export function solve(pairs: Pair[], width: number, height: number): Solved | null {
  const pts = pairs.filter((x) => x.uv)
  if (pts.length < 6) return null
  // Normalize both point sets for a stable solution.
  const n = pts.length
  const c3 = [0, 0, 0], c2 = [0, 0]
  const img = pts.map((x) => [x.uv[0] * width, x.uv[1] * height])
  pts.forEach((x, i) => { for (let k = 0; k < 3; k++) c3[k] += x.p[k] / n; c2[0] += img[i][0] / n; c2[1] += img[i][1] / n })
  let s3 = 0, s2 = 0
  pts.forEach((x, i) => { s3 += Math.hypot(x.p[0] - c3[0], x.p[1] - c3[1], x.p[2] - c3[2]) / n; s2 += Math.hypot(img[i][0] - c2[0], img[i][1] - c2[1]) / n })
  const k3 = Math.sqrt(3) / (s3 || 1), k2 = Math.SQRT2 / (s2 || 1)
  const rows: number[][] = []
  pts.forEach((pt, i) => {
    const X = (pt.p[0] - c3[0]) * k3, Y = (pt.p[1] - c3[1]) * k3, Z = (pt.p[2] - c3[2]) * k3
    const x = (img[i][0] - c2[0]) * k2, y = (img[i][1] - c2[1]) * k2
    rows.push([X, Y, Z, 1, 0, 0, 0, 0, -x * X, -x * Y, -x * Z, -x])
    rows.push([0, 0, 0, 0, X, Y, Z, 1, -y * X, -y * Y, -y * Z, -y])
  })
  const AtA = Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)))
  const p = smallestEigen(AtA)
  // Undo the normalization: P = T2^-1 Pn T3.
  const Pn = [p.slice(0, 4), p.slice(4, 8), p.slice(8, 12)]
  const T3 = [[k3, 0, 0, -k3 * c3[0]], [0, k3, 0, -k3 * c3[1]], [0, 0, k3, -k3 * c3[2]], [0, 0, 0, 1]]
  const T2i = [[1 / k2, 0, c2[0]], [0, 1 / k2, c2[1]], [0, 0, 1]]
  const PnT3 = Pn.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, k) => s + v * T3[k][j], 0)))
  let P = T2i.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, k) => s + v * PnT3[k][j], 0)))
  let M = [P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2], P[2][0], P[2][1], P[2][2]]
  if (det3(M) < 0) { P = P.map((r) => r.map((v) => -v)); M = M.map((v) => -v) }
  const { K, R } = rq(M)
  const scale = K[8]
  const Kn = K.map((v) => v / scale)
  const t = mul33(inv33(K), [P[0][3], 0, 0, P[1][3], 0, 0, P[2][3], 0, 0])
  const tv: V3 = [t[0], t[3], t[6]]
  // Reprojection error.
  let err = 0
  pts.forEach((pt, i) => {
    const Xc = [0, 1, 2].map((r) => R[r * 3] * pt.p[0] + R[r * 3 + 1] * pt.p[1] + R[r * 3 + 2] * pt.p[2] + tv[r])
    const u = (Kn[0] * Xc[0] + Kn[1] * Xc[1] + Kn[2] * Xc[2]) / Xc[2]
    const v = (Kn[4] * Xc[1] + Kn[5] * Xc[2]) / Xc[2]
    err += Math.hypot(u - img[i][0], v - img[i][1]) / n
  })
  return { K: Kn, R, t: tv, error: err }
}

// A 3D point to projector pixels (for drawing and for tests).
export function project(s: Solved, p: V3): [number, number] {
  const Xc = [0, 1, 2].map((r) => s.R[r * 3] * p[0] + s.R[r * 3 + 1] * p[1] + s.R[r * 3 + 2] * p[2] + s.t[r])
  return [(s.K[0] * Xc[0] + s.K[1] * Xc[1] + s.K[2] * Xc[2]) / Xc[2], (s.K[4] * Xc[1] + s.K[5] * Xc[2]) / Xc[2]]
}

// The OpenGL (three.js) camera for a solved projector: a view matrix and a
// projection matrix, both column-major like three.js Matrix4.elements.
export function glCamera(s: Solved, width: number, height: number, near = 0.05, far = 200) {
  const { K, R, t } = s
  const fx = K[0], sk = K[1], cx = K[2], fy = K[4], cy = K[5]
  // OpenCV camera (y down, z forward) to GL camera (y up, z back).
  const F = [1, -1, -1]
  const view = [
    R[0] * F[0], R[1] * F[0], R[2] * F[0], t[0] * F[0],
    R[3] * F[1], R[4] * F[1], R[5] * F[1], t[1] * F[1],
    R[6] * F[2], R[7] * F[2], R[8] * F[2], t[2] * F[2],
    0, 0, 0, 1,
  ]
  const proj = [
    (2 * fx) / width, (-2 * sk) / width, 1 - (2 * cx) / width, 0,
    0, (2 * fy) / height, (2 * cy) / height - 1, 0,
    0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
    0, 0, -1, 0,
  ]
  const colMajor = (m: number[]) => [0, 1, 2, 3].flatMap((c) => [m[c], m[4 + c], m[8 + c], m[12 + c]])
  return { view: colMajor(view), proj: colMajor(proj) }
}
