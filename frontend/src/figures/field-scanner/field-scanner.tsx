import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react"
import { translateAlong } from "@/iso/iso-kit"
import { Dots, IsoFigure, Line, Plate, Solid } from "@/iso/react/draw"
import { follow, spring, useInView, useLoop, useReadout, type Spring } from "@/iso/react/live"
import "@/iso/iso.css"
import {
  BASE, CELL_ORDER, COLS, FLAT, GANTRY, HEIGHT, LABEL_TEXT, P, REACH, REST, TRAY_ART, WIDTH,
  cellSvg, columnX, heightOf, railAt,
} from "./geometry"

const BACK_RAIL = railAt(-76)
const FRONT_RAIL = railAt(76)
const SWEEP_S = 7          // tour: seconds for one pass
const HOLD_S = 1.6         // tour: pause at each end

/** Field scanner figure. `values` are the 6 × 5 block yields (t/ha), null where a block has no corn. */
export function FieldScanner({ values }: { values: (number | null)[] }) {
  const stage = useRef<HTMLDivElement>(null)
  const back = useRef<SVGGElement>(null)
  const front = useRef<SVGGElement>(null)
  const cells = useRef<(SVGGElement | null)[]>([])
  const inView = useInView(stage)
  const { anchor, say } = useReadout<HTMLDivElement>()
  const total = values.filter((v) => v != null).length

  const s = useRef({
    x: REST, target: REST, touring: true, clock: 0, phase: "sweep" as "sweep" | "hold" | "clear",
    scanned: values.map(() => false), springs: values.map((): Spring => ({ at: FLAT, rate: 0 })), drawn: values.map(() => -1), idle: 0,
  })

  const readout = () => {
    const st = s.current
    const col = Math.round((st.x - columnX(0)) / (columnX(1) - columnX(0)))
    const done = st.scanned.filter((v, i) => v && values[i] != null).length
    if (col < 0 || col >= COLS || Math.abs(st.x - columnX(col)) > 11) return `${done} of ${total} blocks mapped`
    const under = values.filter((v, i) => i % COLS === col && v != null) as number[]
    const mean = under.reduce((a, b) => a + b, 0) / under.length
    return `column ${col + 1} · ${mean.toFixed(2)} t/ha · ${done} of ${total} mapped`
  }

  const draw = () => {
    const st = s.current
    const shift = translateAlong(P, [st.x - REST, 0, 0])
    back.current?.setAttribute("transform", shift)
    front.current?.setAttribute("transform", shift)
    values.forEach((v, i) => {
      const h = st.springs[i].at
      if (v == null || Math.abs(h - st.drawn[i]) < 0.02) return
      st.drawn[i] = h
      const g = cells.current[i]
      if (g) g.innerHTML = cellSvg(i, h)
    })
    say(readout())
  }

  const kick = useLoop((dt, calm) => {
    const st = s.current
    if (st.touring) {
      st.clock += dt
      if (st.phase === "sweep") { st.target = REACH[1]; if (Math.abs(st.x - REACH[1]) < 0.5) { st.phase = "hold"; st.clock = 0 } }
      else if (st.phase === "hold" && st.clock > HOLD_S) { st.phase = "clear"; st.scanned = st.scanned.map(() => false) }
      else if (st.phase === "clear") { st.target = REACH[0]; if (Math.abs(st.x - REACH[0]) < 0.5 && st.clock > HOLD_S * 2) { st.phase = "sweep"; st.clock = 0 } }
    }
    const speed = st.touring ? SWEEP_S / 3 : 0.25
    st.x = follow(st.x, st.target, dt, speed, calm)
    if (!(st.touring && st.phase === "clear"))
      values.forEach((_, i) => { if (Math.abs(st.x - columnX(i % COLS)) < 11) st.scanned[i] = true })
    let still = st.x === st.target
    values.forEach((v, i) => {
      if (v == null) return
      if (!spring(st.springs[i], st.scanned[i] ? heightOf(v) : FLAT, dt, 140, 16, calm)) still = false
    })
    draw()
    return st.touring || !still
  }, inView)

  useEffect(() => {
    const st = s.current
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {   // one still, finished pose
      st.touring = false
      st.x = st.target = REACH[1]
      st.scanned = st.scanned.map(() => true)
      st.springs.forEach((sp, i) => { if (values[i] != null) sp.at = heightOf(values[i]!) })
    }
    draw()
    return () => clearTimeout(st.idle)
  }, [])

  const steer = (x: number) => {
    const st = s.current
    st.touring = false
    st.target = Math.max(REACH[0], Math.min(REACH[1], x))
    clearTimeout(st.idle)
    st.idle = window.setTimeout(() => { st.touring = true; st.phase = "sweep"; st.clock = 0; kick() }, 4000)
    kick()
  }
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const share = Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width - 0.2) / 0.6))
    steer(REACH[0] + share * (REACH[1] - REACH[0]))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const stops = Array.from({ length: COLS }, (_, c) => columnX(c))
    const here = stops.reduce((best, x, i) => (Math.abs(x - s.current.target) < Math.abs(stops[best] - s.current.target) ? i : best), 0)
    const to = e.key === "ArrowRight" ? Math.min(COLS - 1, here + 1) : e.key === "ArrowLeft" ? Math.max(0, here - 1) : e.key === "Home" ? 0 : e.key === "End" ? COLS - 1 : -1
    if (to < 0) return
    e.preventDefault()
    steer(stops[to])
  }

  return (
    <>
      <Plate fig="Fig 1" title="Field scanner" hint="Move across to scan" readout={`0 of ${total} blocks mapped`}
        keys={[{ mark: "lit", label: "Sensor lens: the satellite's view" }, { mark: "raised", label: "Blocks raised to predicted yield" }]}
        caption={LABEL_TEXT}>
        <div ref={(el) => { stage.current = el; anchor.current = el }} tabIndex={0} role="slider" aria-label="Field scanner: arrow keys move the sensor head from column to column"
          aria-valuemin={1} aria-valuemax={COLS} onPointerMove={onPointer} onKeyDown={onKey} className="outline-none">
          <IsoFigure width={WIDTH} height={HEIGHT} label="A field scanner on a bench: a gantry carrying a sensor head runs on two rails over a tray of 30 sockets holding 22 field blocks. As the lens passes a column, its blocks rise to their predicted 2019 corn yield.">
            <path className="iso-halo" d={BASE.halo} />
            {BASE.feet.map((f, i) => <g key={i}><Solid paths={f.pad} tone="lo" /><Solid paths={f.foot} tone="mid" /></g>)}
            <Solid paths={BASE.plate} tone="mid" />
            <Line d={BASE.groove} tone="lo" />
            <Line d={BASE.screwRings} tone="lo" />
            <Dots points={BASE.screwDots} size={0.5} />
            <Solid paths={BASE.strip} tone="lo" crease="none" />
            <Line d={BASE.ticks.minor} tone="lo" /><Line d={BASE.ticks.major} tone="mid" />
            <Dots points={BASE.stripDots} size={0.45} />
            <Solid paths={BASE.label} tone="lo" crease="none" />
            <Line d={BASE.labelRules} tone="faint" free />
            <Dots points={BASE.labelDots} size={0.45} />

            <Solid paths={BACK_RAIL.rail} tone="mid" />
            {BACK_RAIL.stops.map((p, i) => <Solid key={i} paths={p} tone="mid" />)}
            <Dots points={BACK_RAIL.dots} size={0.45} />

            <g ref={back}>
              <Solid paths={GANTRY.back.bushing} tone="mid" />
              <Dots points={GANTRY.back.dots} size={0.45} />
              <Solid paths={GANTRY.back.collar} tone="mid" />
              <Solid paths={GANTRY.back.post} tone="mid" crease="none" inner={<Line d={GANTRY.back.seam} tone="faint" />} />
            </g>

            <path className="iso-halo" d={TRAY_ART.halo} style={{ filter: "blur(3px)" }} />
            <Solid paths={TRAY_ART.tray} tone="mid" />
            <Line d={TRAY_ART.rim} tone="faint" />
            <Line d={TRAY_ART.sockets} tone="lo" />
            <Dots points={values.flatMap((v, i) => (v == null ? [TRAY_ART.socketDot(i)] : []))} size={0.5} tone="lo" />
            {CELL_ORDER.map((i) => <g key={i} ref={(el) => { cells.current[i] = el }} />)}

            <Solid paths={FRONT_RAIL.rail} tone="mid" />
            {FRONT_RAIL.stops.map((p, i) => <Solid key={i} paths={p} tone="mid" />)}
            <Dots points={FRONT_RAIL.dots} size={0.45} />

            <g ref={front}>
              <Solid paths={GANTRY.front.bushing} tone="mid" />
              <Dots points={GANTRY.front.dots} size={0.45} />
              <Solid paths={GANTRY.front.shaft} tone="mid" crease="none" />
              <Solid paths={GANTRY.front.knob} tone="mid" inner={<Line d={GANTRY.front.knurl} tone="lo" />} />
              <Solid paths={GANTRY.front.collar} tone="mid" />
              <Solid paths={GANTRY.front.post} tone="mid" crease="none" inner={<Line d={GANTRY.front.seam} tone="faint" />} />
              <Solid paths={GANTRY.lens} tone="hi" lit inner={<Line d={GANTRY.lensRing} tone="lit" />} />
              <Solid paths={GANTRY.shroud} tone="mid" />
              <Solid paths={GANTRY.housing} tone="mid" inner={<Line d={GANTRY.housingSeam} tone="faint" />} />
              <Solid paths={GANTRY.bar} tone="mid" />
              <Line d={GANTRY.barGroove} tone="faint" />
              <Dots points={GANTRY.barDots} size={0.45} />
            </g>
          </IsoFigure>
        </div>
      </Plate>
    </>
  )
}
