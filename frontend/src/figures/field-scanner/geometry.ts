/**
 * Field scanner: a gantry with a sensor head runs on two rails over a tray of field blocks.
 * Each block is one sixth-by-fifth slice of the watershed; as the lens passes its column it
 * rises to that block's predicted 2019 corn yield. World units are about 1 px, z up.
 */
import * as k from "@/iso/iso-kit"
import type { Plan, Point3 } from "@/iso/iso-kit"

export const WIDTH = 560
export const HEIGHT = 380

export const PLATE: Plan = { x: -128, y: -92, w: 256, d: 184, r: 8 }
export const PLATE_H = 10
export const FOOT_H = 5
export const RAIL_Y = [-76, 76] as const
export const RAIL = { from: -118, to: 118, d: 6, h: 4 }
export const TRAY: Plan = { x: -70, y: -59, w: 140, d: 118, r: 3 }
export const TRAY_H = 5
export const COLS = 6
export const ROWS = 5
export const PITCH = 22
export const CELL = 19
export const BAR_Z = 64
export const BAR_H = 8
export const REST = -100                       // gantry x at rest
export const REACH: [number, number] = [-100, 100]

export const columnX = (c: number) => -55 + PITCH * c
export const cellPlan = (c: number, r: number): Plan => ({ x: -66 + PITCH * c + 1.5, y: -55 + PITCH * r + 1.5, w: CELL, d: CELL, r: 1.5 })
/** Block height from yield: 8 t/ha stands 2 tall, every extra t/ha adds 6. */
export const heightOf = (tHa: number) => 2 + (tHa - 8) * 6
export const FLAT = 0.8

export const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...k.boxCorners({ x: REACH[0] - 5, y: -82, w: 10, d: 164, r: 0 }, 0, BAR_Z + BAR_H),
    ...k.boxCorners({ x: REACH[1] - 5, y: -82, w: 10, d: 164, r: 0 }, 0, BAR_Z + BAR_H)],
  WIDTH, HEIGHT, { pad: 26, azimuth: 45 },
)

export const at = (point: Point3) => k.iso(point, P)
const byDepth = <T extends [number, number]>(points: T[]) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))

/* ---- base: plate on four feet, groove, corner screws, ruler strip, label plate ---- */
const feet = byDepth(k.corners(PLATE, 22)).map(([x, y]) => ({
  pad: k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28),
  foot: k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28),
}))
const screws = k.corners(PLATE, 9)
const STRIP: Plan = { x: -112, y: 83.5, w: 224, d: 6, r: 1 }
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y + 0.8, 0.6, [2, 3.6], P)
const LABEL: Plan = { x: -124, y: -40, w: 13, d: 80, r: 1.5 }

export const BASE = {
  halo: k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P),
  feet,
  plate: k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6),
  groove: k.planOutline(k.insetPlan(PLATE, 5), 0, P),
  screwRings: screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""),
  screwDots: screws.map(([x, y]) => at([x, y, 0])),
  strip: k.slabOf(STRIP, 0, 0.6, P, 3),
  ticks,
  stripDots: [at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])],
  label: k.slabOf(LABEL, 0, 0.8, P, 3),
  labelRules: [-117.5, -114.5].map((x) => k.lineOnTop([x, LABEL.y + 10], [x, LABEL.y + LABEL.d - 10], 0.8, P)).join("")
    + k.lineOnTop([-120.5, LABEL.y + 10], [-120.5, LABEL.y + 46], 0.8, P),
  labelDots: [at([LABEL.x + 6.5, LABEL.y + 4, 0.8]), at([LABEL.x + 6.5, LABEL.y + LABEL.d - 4, 0.8])],
}

/* ---- rails with end stops ---- */
export const railAt = (y: number) => ({
  rail: k.slabOf({ x: RAIL.from, y: y - RAIL.d / 2, w: RAIL.to - RAIL.from, d: RAIL.d, r: 1 }, 0, RAIL.h, P, 3, 0.4),
  stops: [RAIL.from - 6, RAIL.to].map((x) => k.slabOf({ x, y: y - 5, w: 6, d: 10, r: 1.2 }, 0, 9, P, 3, 0.5)),
  dots: [RAIL.from + 6, RAIL.to - 6].map((x) => at([x, y, RAIL.h])).concat([RAIL.from - 3, RAIL.to + 3].map((x) => at([x, y, 9]))),
})

/* ---- tray with 30 sockets ---- */
const sockets = Array.from({ length: COLS * ROWS }, (_, i) => cellPlan(i % COLS, Math.floor(i / COLS)))
export const TRAY_ART = {
  halo: k.haloOf(k.insetPlan(TRAY, 2), 0, 0.1, P),
  tray: k.slabOf(TRAY, 0, TRAY_H, P, 4, 0.6),
  rim: k.planOutline(k.insetPlan(TRAY, 2.2), TRAY_H, P, 4),
  sockets: sockets.map((plan) => k.planOutline(k.insetPlan(plan, -0.6), TRAY_H, P, 3)).join(""),
  socketDot: (i: number) => { const p = sockets[i]; return at([p.x + p.w / 2, p.y + p.d / 2, TRAY_H]) },
}

/** Blocks back to front, so the live component can paint them in order. */
export const CELL_ORDER = Array.from({ length: COLS * ROWS }, (_, i) => i)
  .sort((a, b) => {
    const pa = cellPlan(a % COLS, Math.floor(a / COLS)), pb = cellPlan(b % COLS, Math.floor(b / COLS))
    return k.depthOf([pa.x + CELL / 2, pa.y + CELL / 2, 0], P) - k.depthOf([pb.x + CELL / 2, pb.y + CELL / 2, 0], P)
  })

/** One block at height h, as SVG markup (rebuilt only while it moves). */
export function cellSvg(i: number, h: number) {
  const plan = cellPlan(i % COLS, Math.floor(i / COLS))
  return k.solidSvg(k.slabOf(plan, TRAY_H, h, P, 3, h > 2 ? 0.4 : 0), { tone: "hi", crease: "lo" })
    + k.lineSvg(k.planOutline(k.insetPlan(plan, 2.4), TRAY_H + h, P, 3), { tone: "faint" })
}

/* ---- gantry, built at x = REST and moved with translateAlong ---- */
const g = REST
const bushing = (y: number) => k.slabOf({ x: g - 10, y: y - 5, w: 20, d: 10, r: 2 }, RAIL.h, 9, P, 3, 0.5)
const post = (y: number) => ({
  collar: k.cylinder(g, y, 4.4, RAIL.h + 9, 3, P, 24),
  post: k.cylinder(g, y, 3.2, RAIL.h + 12, BAR_Z - RAIL.h - 12, P, 24),
  seam: k.sideArc(g, y, 3.2, 40, P, 12),
})
const HOUSING: Plan = { x: g - 9, y: -9, w: 18, d: 18, r: 3 }
const BAR: Plan = { x: g - 5, y: -82, w: 10, d: 164, r: 2 }
const KNOB: [number, number] = [g + 13.5, RAIL_Y[1] + 2]

export const GANTRY = {
  back: { bushing: bushing(RAIL_Y[0]), ...post(RAIL_Y[0]), dots: [at([g - 6, RAIL_Y[0] - 2.5, RAIL.h + 9]), at([g + 6, RAIL_Y[0] - 2.5, RAIL.h + 9])] },
  front: {
    bushing: bushing(RAIL_Y[1]),
    dots: [at([g - 6, RAIL_Y[1] + 2.5, RAIL.h + 9]), at([g + 6, RAIL_Y[1] + 2.5, RAIL.h + 9])],
    shaft: k.slabOf({ x: g + 10, y: RAIL_Y[1] + 0.6, w: 2.4, d: 2.8, r: 0.6 }, RAIL.h + 3.4, 2.6, P, 2),
    knob: k.cylinder(KNOB[0] + 1.2, KNOB[1], 3, RAIL.h + 2, 6.6, P, 20),
    knurl: k.knurl(KNOB[0] + 1.2, KNOB[1], 3, RAIL.h + 2, RAIL.h + 8.6, 18, P),
    ...post(RAIL_Y[1]),
  },
  lens: k.cylinder(g, 0, 5.4, 42, 4.6, P, 32),
  lensRing: k.sideArc(g, 0, 5.4, 44.2, P, 20),
  shroud: k.cylinder(g, 0, 7.4, 46.6, 3.4, P, 32),
  housing: k.slabOf(HOUSING, 50, BAR_Z - 50, P, 4, 0.5),
  housingSeam: k.sideSeam(HOUSING, 57, P, 4),
  bar: k.slabOf(BAR, BAR_Z, BAR_H, P, 3, 0.6),
  barGroove: k.planOutline(k.insetPlan(BAR, 1.8), BAR_Z + BAR_H, P, 3),
  barDots: [RAIL_Y[0], -9, 9, RAIL_Y[1]].flatMap((y) => [at([g - 2.6, y, BAR_Z + BAR_H]), at([g + 2.6, y, BAR_Z + BAR_H])]),
}

export const LABEL_TEXT = "The 2019 corn map, averaged into 6 × 5 blocks of the watershed. Each block rises to its predicted yield as the sensor head passes over its column."
