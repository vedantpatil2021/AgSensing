/**
 * Orbit survey: the whole project on one bench. A satellite rides an orbit arc over a dot-matrix world map,
 * finds the Maumee watershed, then images a crop patch whose 30 m cells rise to their predicted yield.
 * A weather mast stands for the August temperature and rain; a dial gauge reads the yield under the lens.
 * World units are about 1 px, z up; +x runs to the lower right, +y to the lower left.
 */
import * as k from "@/iso/iso-kit"
import type { Flat, Plan, Point3 } from "@/iso/iso-kit"

export const WIDTH = 640
export const HEIGHT = 470

export const PLATE: Plan = { x: -162, y: -66, w: 324, d: 132, r: 9 }
const PLATE_H = 10
const FOOT_H = 5

/* ---- the map: equirectangular, longitude along x, north toward -y ---- */
export const MAP: Plan = { x: -144, y: -28, w: 134, d: 56, r: 3 }
export const MAP_H = 4
const SX = 126 / 360
export const lonLat = (lon: number, lat: number): [number, number] => [-139 + (lon + 180) * SX, -(lat - 11) * SX]
export const MAUMEE = lonLat(-84.5, 41.2)

/* ---- the crop patch: 6 x 5 cells of the 2019 corn map ---- */
export const TRAY: Plan = { x: 14, y: -50, w: 120, d: 100, r: 3 }
export const TRAY_H = 5
export const COLS = 6
export const ROWS = 5
const PITCH = 18
const CELL = 15
export const cellPlan = (c: number, r: number): Plan => ({ x: TRAY.x + 7.5 + PITCH * c, y: TRAY.y + 6.5 + PITCH * r, w: CELL, d: CELL, r: 1.5 })
export const columnX = (c: number) => TRAY.x + 7.5 + PITCH * c + CELL / 2
/** Cell height from yield: 8 t/ha stands 2 tall, every extra t/ha adds 5. */
export const heightOf = (tHa: number) => Math.max(1.2, 2 + (tHa - 8) * 5)
export const FLAT = 0.8

/* ---- the orbit arc in the plane y = 0, standing on two posts ---- */
const R = 150
const ZC = 40
const RZ = 90
export const arcZ = (x: number) => ZC + RZ * Math.sin(Math.acos(Math.max(-1, Math.min(1, x / R))))
export const REST = -130
export const REACH: [number, number] = [-130, 124]
const DROP = 42                                   // carriage centre to lens face
export const groundAt = (x: number) => (x > MAP.x && x < MAP.x + MAP.w ? MAP_H : x > TRAY.x && x < TRAY.x + TRAY.w ? TRAY_H : 0)

export const STATION: [number, number] = [2, -46]
export const GAUGE: [number, number] = [-1, 47]
export const GAUGE_SPAN = Math.PI * 1.5          // needle sweep, 6 to 12.5 t/ha
export const GAUGE_RANGE: [number, number] = [6, 12.5]

const fitPoints: Point3[] = [
  ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
  ...Array.from({ length: 13 }, (_, i): Point3 => { const x = -R + (i / 12) * 2 * R; return [x, 0, arcZ(x) + 3] }),
  ...[REACH[0], 0, REACH[1]].flatMap((x): Point3[] => [[x - 10, -42, arcZ(x) - 30], [x + 10, 42, arcZ(x) - 30]]),
]
export const P = k.fitProjection(fitPoints, WIDTH, HEIGHT, { pad: 22, azimuth: 45 })
export const at = (point: Point3) => k.iso(point, P)
const depth = ([x, y]: [number, number]) => k.depthOf([x, y, 0], P)

/* ---- base: plate on four feet, groove, corner screws, label plate ---- */
const screws = k.corners(PLATE, 9)
const LABEL: Plan = { x: 34, y: 52, w: 84, d: 7, r: 1.5 }
export const BASE = {
  halo: k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P),
  feet: [...k.corners(PLATE, 24)].sort((a, b) => depth(a) - depth(b)).map(([x, y]) => ({
    pad: k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28),
    foot: k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28),
  })),
  plate: k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6),
  groove: k.planOutline(k.insetPlan(PLATE, 5), 0, P),
  screwRings: screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""),
  screwDots: screws.map(([x, y]) => at([x, y, 0])),
  label: k.slabOf(LABEL, 0, 0.8, P, 3),
  labelRules: [55, 57].map((y) => k.lineOnTop([LABEL.x + 8, y], [LABEL.x + LABEL.w - 8, y], 0.8, P)).join("")
    + k.lineOnTop([LABEL.x + 8, 53.6], [LABEL.x + 40, 53.6], 0.8, P),
  labelDots: [at([LABEL.x + 4, LABEL.y + 3.5, 0.8]), at([LABEL.x + LABEL.w - 4, LABEL.y + 3.5, 0.8])],
}

/* ---- world map ---- */
type Ring = [number, number][]
const LAND: Ring[] = [
  // North America
  [[-166, 68], [-156, 71], [-140, 69.5], [-125, 70], [-110, 68], [-95, 68], [-85, 70], [-80, 63], [-94, 59], [-90, 57], [-82, 55], [-78, 52], [-79, 58],
    [-76, 62], [-70, 61], [-64, 60], [-60, 55], [-56, 52], [-60, 47], [-66, 45], [-70, 42], [-74, 40], [-76, 35], [-81, 31], [-80, 26], [-82, 26], [-84, 30],
    [-90, 29], [-97, 27], [-97, 22], [-92, 19], [-87, 21], [-88, 16], [-83, 15], [-83, 10], [-79, 9], [-80, 7], [-85, 10], [-91, 14], [-96, 16], [-105, 20],
    [-106, 23], [-110, 24], [-112, 27], [-115, 30], [-117, 32.5], [-120, 34.5], [-124, 40], [-124, 46], [-123, 49], [-128, 51], [-133, 56], [-140, 60],
    [-147, 61], [-152, 59], [-158, 57], [-164, 55], [-158, 58.5], [-162, 60], [-165, 62], [-164, 64], [-168, 65.5]],
  [[-73, 78], [-60, 82], [-35, 83], [-20, 80], [-20, 70], [-30, 68], [-42, 60], [-50, 62], [-55, 68], [-60, 76]],                          // Greenland
  [[-120, 76], [-100, 79], [-85, 80], [-75, 78], [-80, 73], [-95, 74], [-110, 72], [-122, 72]],                                               // Arctic islands
  [[-80, 73], [-68, 70], [-62, 67], [-66, 63], [-75, 65], [-82, 69]],                                                                          // Baffin
  [[-85, 22], [-80, 23], [-75, 20], [-78, 20]],                                                                                                 // Cuba
  [[-24, 64], [-22, 66.5], [-15, 66.5], [-13, 65], [-18, 63.5]],                                                                               // Iceland
  // South America
  [[-80, 9], [-77, 8], [-72, 12], [-63, 11], [-60, 8], [-52, 5], [-50, 0], [-44, -2], [-35, -5], [-35, -9], [-39, -15], [-40, -22], [-48, -26],
    [-53, -34], [-58, -35], [-62, -39], [-65, -42], [-66, -47], [-69, -51], [-68, -55], [-72, -54], [-75, -50], [-74, -43], [-73, -37], [-71, -30],
    [-70, -18], [-76, -14], [-81, -6], [-81, -2], [-78, 2], [-77, 7]],
  // Africa and Madagascar
  [[-17, 21], [-16, 28], [-10, 30], [-9, 33], [-6, 36], [3, 37], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [34, 28], [37, 22], [39, 16], [43, 12],
    [51, 12], [51, 10], [47, 5], [41, -2], [40, -10], [40, -15], [35, -20], [35, -24], [32, -28], [28, -33], [20, -35], [18, -32], [15, -27], [12, -17],
    [13, -12], [12, -5], [9, -1], [9, 4], [5, 6], [-2, 5], [-8, 4], [-13, 8], [-17, 12], [-17, 15]],
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -16]],
  // Eurasia
  [[-9, 37], [-9, 43], [-2, 43.5], [-4, 48], [2, 51], [5, 53], [8, 54], [8, 57], [10, 59], [5, 62], [14, 67], [20, 70], [28, 71], [40, 68], [44, 68],
    [54, 69], [60, 69], [70, 73], [80, 73], [90, 76], [105, 78], [113, 74], [130, 71], [140, 72], [160, 70], [170, 70], [180, 68], [180, 65], [177, 62],
    [163, 60], [160, 54], [156, 51], [156, 57], [163, 62], [150, 59], [142, 59], [136, 54], [140, 48], [135, 43], [130, 42], [129, 35], [126, 37],
    [126, 40], [122, 40], [121, 37], [122, 31], [120, 26], [115, 23], [108, 21], [108, 17], [109, 12], [105, 9], [103, 10], [100, 13], [100, 8],
    [103, 1.5], [100, 4], [98, 9], [98, 16], [94, 17], [92, 22], [88, 22], [85, 19], [80, 15], [80, 10], [77, 8], [73, 17], [73, 21], [68, 23], [66, 25],
    [58, 25], [56, 27], [52, 28], [50, 30], [48, 30], [50, 26], [52, 24], [56, 24], [57, 22], [59, 22], [55, 17], [52, 16], [45, 13], [43, 13], [39, 21],
    [35, 28], [34, 31], [36, 36], [30, 36.5], [27, 37], [26, 40], [23, 40], [24, 37], [22, 36.5], [19, 40], [19, 42], [13, 45.5], [12.5, 44], [16, 41],
    [18.5, 40], [16, 38], [15.5, 40.5], [12, 42], [10, 44], [7, 43.5], [3, 43], [3, 42], [0, 39], [-1, 37], [-5, 36]],
  [[-5, 50], [1, 51], [2, 53], [-2, 56], [-2, 58.5], [-5, 58.6], [-6, 56], [-5, 54.5], [-3, 54], [-5, 52]],                                 // Britain
  [[-10, 52], [-6, 52], [-6, 55], [-8, 55.3], [-10, 54]],                                                                                       // Ireland
  [[130, 31], [131, 34], [135, 34], [140, 35], [141, 38], [142, 41], [141, 45.5], [145, 44], [141, 41], [140, 36], [137, 34.5], [133, 33]],     // Japan
  [[95, 5.5], [98, 4], [106, -6], [104, -5.5], [100, -1]],                                                                                      // Sumatra
  [[109, 1], [111, -3], [116, -4], [118, 1], [117, 7], [115, 5]],                                                                               // Borneo
  [[105, -6], [114, -7], [114, -8.5], [106, -7.5]],                                                                                             // Java
  [[131, -1], [141, -2.5], [150, -6], [150, -10.5], [143, -9], [138, -8], [135, -4.5]],                                                         // New Guinea
  [[120, 18], [122, 18], [124, 13], [126, 7], [122, 7], [120, 14]],                                                                             // Philippines
  // Australia and New Zealand
  [[114, -22], [114, -26], [115, -34], [118, -35], [124, -34], [129, -31.5], [132, -32], [135, -35], [138, -35.5], [140, -38], [146, -39], [150, -37.5],
    [153, -32], [153, -25], [149, -20], [146, -18], [145, -15], [142.5, -10.5], [141.5, -13], [141, -17], [136, -15], [137, -12], [132, -11], [129, -15],
    [125, -14], [122, -17], [117, -20.5]],
  [[172.5, -34.5], [178, -37.5], [175, -41.5], [171, -44], [166.5, -46], [168, -46.5], [172, -43], [174, -41]],
]
const WATER: Ring[] = [
  [[28, 41], [28, 46], [33, 46], [38, 47], [41, 42], [36, 41.5]],                                                                              // Black Sea
  [[47, 37], [49, 46], [53, 47], [54, 40], [52, 37]],                                                                                          // Caspian
  [[10, 54], [18, 55], [21, 57], [22, 60], [30, 60], [25, 65], [22, 66], [17, 61], [18, 59], [16, 56], [12, 56]],                              // Baltic
]
const inside = (ring: Ring, lon: number, lat: number) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
const land = { us: [] as Flat[], rest: [] as Flat[] }
for (let lat = 77; lat >= -55; lat -= 5) {
  for (let lon = -177.5 + ((77 - lat) / 5 % 2) * 2.5; lon < 180; lon += 5) {
    if (!LAND.some((r) => inside(r, lon, lat)) || WATER.some((r) => inside(r, lon, lat))) continue
    const [x, y] = lonLat(lon, lat)
    const us = lon > -125 && lon < -67 && lat > 25 && lat < 49.5
    if (Math.hypot(x - MAUMEE[0], y - MAUMEE[1]) > 2.4) (us ? land.us : land.rest).push(at([x, y, MAP_H]))
  }
}
const RIM = k.insetPlan(MAP, 2.5)
const STRIP: Plan = { x: -142, y: 32, w: 130, d: 5, r: 1 }
export const WORLD = {
  halo: k.haloOf(MAP, 0, 0.1, P),
  slab: k.slabOf(MAP, 0, MAP_H, P, 4, 0.6),
  rim: k.planOutline(RIM, MAP_H, P, 4),
  graticule: [-120, -60, 0, 60, 120].map((lon) => k.lineOnTop([lonLat(lon, 0)[0], RIM.y], [lonLat(lon, 0)[0], RIM.y + RIM.d], MAP_H, P)).join("")
    + [-30, 30, 60].map((lat) => k.lineOnTop([RIM.x, lonLat(0, lat)[1]], [RIM.x + RIM.w, lonLat(0, lat)[1]], MAP_H, P)).join(""),
  equator: k.lineOnTop([RIM.x, lonLat(0, 0)[1]], [RIM.x + RIM.w, lonLat(0, 0)[1]], MAP_H, P),
  us: land.us,
  rest: land.rest,
  maumee: at([MAUMEE[0], MAUMEE[1], MAP_H]),
  maumeeRing: k.ring(MAUMEE[0], MAUMEE[1], 2.2, MAP_H, P, 20),
  strip: k.slabOf(STRIP, 0, 0.6, P, 3),
  ticks: k.topTicks(lonLat(-180, 0)[0], lonLat(180, 0)[0], 3.5, 3, STRIP.y + 0.8, 0.6, [1.4, 2.8], P),
  stripDots: [at([STRIP.x + 1.6, STRIP.y + 3.6, 0.6]), at([STRIP.x + STRIP.w - 1.6, STRIP.y + 3.6, 0.6])],
}

/* ---- crop patch tray ---- */
const sockets = Array.from({ length: COLS * ROWS }, (_, i) => cellPlan(i % COLS, Math.floor(i / COLS)))
export const PATCH = {
  halo: k.haloOf(k.insetPlan(TRAY, 2), 0, 0.1, P),
  tray: k.slabOf(TRAY, 0, TRAY_H, P, 4, 0.6),
  rim: k.planOutline(k.insetPlan(TRAY, 2.2), TRAY_H, P, 4),
  sockets: sockets.map((plan) => k.planOutline(k.insetPlan(plan, -0.6), TRAY_H, P, 3)).join(""),
  socketDot: (i: number) => { const p = sockets[i]; return at([p.x + p.w / 2, p.y + p.d / 2, TRAY_H]) },
}
export const CELL_ORDER = Array.from({ length: COLS * ROWS }, (_, i) => i)
  .sort((a, b) => depth([sockets[a].x, sockets[a].y]) - depth([sockets[b].x, sockets[b].y]))

/** One field cell at height h with three crop rows on top, as SVG markup (rebuilt only while it moves). */
export function cellSvg(i: number, h: number) {
  const p = sockets[i], z = TRAY_H + h, edge = k.insetPlan(p, 2.4)
  const rows = [4.6, 7.5, 10.4].map((dy) => k.lineOnTop([edge.x, p.y + dy], [edge.x + edge.w, p.y + dy], z, P)).join("")
  return k.solidSvg(k.slabOf(p, TRAY_H, h, P, 3, h > 2 ? 0.4 : 0), { tone: "hi", crease: "lo" })
    + k.lineSvg(k.planOutline(edge, z, P, 3), { tone: "faint" }) + k.lineSvg(rows, { tone: "lo" })
}

/* ---- weather mast: rain gauge, louvred screen, cross-arm, cup anemometer, wind vane ---- */
const [sx, sy] = STATION
const SCREEN: Plan = { x: sx - 3.5, y: sy - 3.5, w: 7, d: 7, r: 0.8 }
const ARM: Plan = { x: sx - 9, y: sy - 1, w: 18, d: 2, r: 0.5 }
const cups = [0, 1, 2].map((i) => { const a = i * (Math.PI * 2 / 3) + 0.4; return [sx + 5 * Math.cos(a), sy + 5 * Math.sin(a)] as [number, number] })
  .sort((a, b) => depth(a) - depth(b))
export const MAST = {
  gauge: k.cylinder(sx + 7, sy - 12, 3.2, 0, 9, P, 24, 0.4),
  gaugeMouth: k.ring(sx + 7, sy - 12, 2.2, 9, P, 20),
  pad: k.cylinder(sx, sy, 6, 0, 2, P, 28, 0.4),
  padDots: [0, 1, 2, 3].map((i) => at([sx + 4.2 * Math.cos(i * Math.PI / 2 + 0.78), sy + 4.2 * Math.sin(i * Math.PI / 2 + 0.78), 2])),
  low: k.cylinder(sx, sy, 1.3, 2, 22, P, 16),
  screen: k.slabOf(SCREEN, 24, 10, P, 3, 0.4),
  louvres: [26.5, 29, 31.5].map((z) => k.sideSeam(SCREEN, z, P, 3)).join(""),
  high: k.cylinder(sx, sy, 1.3, 34, 32, P, 16),
  arm: k.slabOf(ARM, 66, 1.6, P, 2),
  vane: k.slabOf({ x: sx + 6, y: sy - 0.3, w: 4, d: 0.6, r: 0 }, 67.6, 3.4, P, 1),
  hub: k.cylinder(sx - 5, sy, 1.2, 67.6, 3.4, P, 14),
  spokes: cups.map(([x, y]) => k.segment([sx - 5, sy, 70.2], [x - 5, y, 70.2], P)).join(""),
  cups: cups.map(([x, y]) => k.cylinder(x - 5, y, 1.5, 69.2, 2, P, 14)),
}

/* ---- dial gauge: the model's reading ---- */
const [gx, gy] = GAUGE
export const DIAL = {
  base: k.cylinder(gx, gy, 10, 0, 2.4, P, 36, 0.5),
  body: k.cylinder(gx, gy, 8.8, 2.4, 5, P, 36, 0.5),
  bezel: k.ring(gx, gy, 8, 7.4, P, 36),
  ticks: k.radialTicks(gx, gy, 7.4, 13, 2, 7.4, [1, 2], P, -GAUGE_SPAN / 2, GAUGE_SPAN),
  needle: (share: number) => {
    const a = -GAUGE_SPAN / 2 + share * GAUGE_SPAN
    return k.lineOnTop([gx, gy], [gx + Math.sin(a) * 5.6, gy - Math.cos(a) * 5.6], 7.4, P)
  },
  cap: at([gx, gy, 7.4]),
}

/* ---- orbit arc on two posts ---- */
const arcPoints = (dr: number, y: number, z0 = 0) => Array.from({ length: 73 }, (_, i): Point3 => {
  const t = Math.PI - (i / 72) * Math.PI
  return [(R + dr) * Math.cos(t), y, ZC + z0 + (RZ + dr) * Math.sin(t)]
})
const outerFront = arcPoints(2, 3), innerFront = arcPoints(-2, 3), outerBack = arcPoints(2, -3)
const arcTicks = Array.from({ length: 17 }, (_, i) => {
  const t = Math.PI * (i + 1) / 18, big = (i + 1) % 3 === 0, len = big ? 2.6 : 1.4
  return k.segment([(R - 2) * Math.cos(t), 3, ZC + (RZ - 2) * Math.sin(t)], [(R - 2 + len) * Math.cos(t), 3, ZC + (RZ - 2 + len) * Math.sin(t)], P)
})
const post = (x: number) => ({
  flange: k.cylinder(x, 0, 6.5, 0, 2, P, 28, 0.4),
  flangeDots: [0, 1, 2, 3].map((i) => at([x + 4.6 * Math.cos(i * Math.PI / 2 + 0.78), 4.6 * Math.sin(i * Math.PI / 2 + 0.78), 2])),
  post: k.cylinder(x, 0, 3.6, 2, ZC - 6, P, 24),
  seam: k.sideArc(x, 0, 3.6, 14, P, 12),
  block: k.slabOf({ x: x - 5, y: -4, w: 10, d: 8, r: 1.2 }, ZC - 4, 6, P, 3, 0.4),
  blockDot: at([x, 4, ZC - 1]),
})
export const ORBIT = {
  posts: [post(-R), post(R)],
  outer: k.pathOf([...outerFront, ...[...outerBack].reverse()].map(at), true),
  face: k.pathOf([...outerFront, ...[...innerFront].reverse()].map(at), true),
  edge: k.pathOf(outerFront.map(at)) + k.pathOf(innerFront.map(at)) + k.pathOf(outerBack.map(at)),
  ticks: arcTicks.filter((_, i) => (i + 1) % 3 !== 0).join(""),
  majors: arcTicks.filter((_, i) => (i + 1) % 3 === 0).join(""),
}

/* ---- satellite, built at x = REST and moved with translateAlong ---- */
const x0 = REST, zA = arcZ(REST)
const BUS: Plan = { x: x0 - 8, y: -8, w: 16, d: 16, r: 1.8 }
const panel = (y: number) => {
  const plan: Plan = { x: x0 - 10, y, w: 20, d: 30, r: 0.8 }, z = zA - 30.4
  const grid = [7.5, 15, 22.5].map((dy) => k.lineOnTop([plan.x, y + dy], [plan.x + plan.w, y + dy], z + 1.2, P)).join("")
    + k.lineOnTop([x0, y], [x0, y + plan.d], z + 1.2, P)
  return { panel: k.slabOf(plan, z, 1.2, P, 2), grid }
}
export const SAT = {
  back: { arm: k.slabOf({ x: x0 - 1, y: -12.5, w: 2, d: 5, r: 0.4 }, zA - 30.6, 1.6, P, 2), ...panel(-42) },
  hanger: k.cylinder(x0, 0, 1.2, zA - 22, 18, P, 14),
  bus: k.slabOf(BUS, zA - 38, 16, P, 3, 0.5),
  busSeam: k.sideSeam(BUS, zA - 31, P, 3),
  busDots: [at([x0 - 5.5, -5.5, zA - 22]), at([x0 + 5.5, 5.5, zA - 22]), at([x0 + 5, -5, zA - 22])],
  antenna: k.rise([x0 + 5, -5], zA - 22, zA - 14, P),
  antennaTip: at([x0 + 5, -5, zA - 14]),
  front: { arm: k.slabOf({ x: x0 - 1, y: 7.5, w: 2, d: 5, r: 0.4 }, zA - 30.6, 1.6, P, 2), ...panel(12) },
  shroud: k.cylinder(x0, 0, 5, zA - 40, 2, P, 28),
  lens: k.cylinder(x0, 0, 3.8, zA - DROP, 2, P, 28),
  lensRing: k.sideArc(x0, 0, 3.8, zA - DROP + 1, P, 16),
  wheel: k.sideRing([x0, 3.6, zA], 4.6, "y", P, 28),
  hub: k.sideRing([x0, 3.7, zA], 1.8, "y", P, 16),
  axle: at([x0, 3.8, zA]),
}
export const satShift = (x: number) => k.translateAlong(P, [x - REST, 0, arcZ(x) - zA])

/** The lens's view: four rays to a 18 x 18 footprint on whatever is below. */
export function beamSvg(x: number) {
  const top: Point3 = [x, 0, arcZ(x) - DROP], g = groundAt(x), h = 9
  const corners: Point3[] = [[x - h, -h, g], [x + h, -h, g], [x + h, h, g], [x - h, h, g]]
  return k.lineSvg(corners.map((c) => k.segment(top, c, P)).join(""), { tone: "lit", dashed: true })
    + k.lineSvg(k.pathOf(corners.map(at), true), { tone: "lit" })
}

export const CAPTION = "A satellite rides its orbit over the world, finds the Maumee watershed, then images a crop patch at 30 m. "
  + "Greenness from the lens and August weather from the mast feed the model; each cell rises to its predicted 2019 corn yield and the dial reads it."
