import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react"
import { Dots, IsoFigure, Line, Plate, Solid } from "@/iso/react/draw"
import { follow, spring, useInView, useLoop, useReadout, type Spring } from "@/iso/react/live"
import "@/iso/iso.css"
import {
  BASE, CAPTION, CELL_ORDER, COLS, DIAL, FLAT, GAUGE_RANGE, HEIGHT, MAP, MAST, MAUMEE, ORBIT, PATCH, REACH, REST, SAT, TRAY, WIDTH, WORLD,
  beamSvg, cellSvg, columnX, heightOf, satShift,
} from "./geometry"

const SPEED = 30            // tour: world units per second along the track
const DWELL_S = 1.4         // tour: pause over the Maumee
const HOLD_S = 2.2          // tour: pause at the end of the patch
const lonOf = (x: number) => (x + 139) / (126 / 360) - 180

type Phase = "find" | "dwell" | "scan" | "hold" | "back"

/** Orbit survey figure. `values` are the 6 x 5 cell yields (t/ha), null where a cell has no corn; `weather` is August of the same year. */
export function OrbitSurvey({ values, weather }: { values: (number | null)[]; weather: { temp: number; ppt: number } }) {
  const stage = useRef<HTMLDivElement>(null)
  const back = useRef<SVGGElement>(null)
  const front = useRef<SVGGElement>(null)
  const beam = useRef<SVGGElement>(null)
  const needle = useRef<SVGPathElement>(null)
  const cells = useRef<(SVGGElement | null)[]>([])
  const inView = useInView(stage)
  const { anchor, say } = useReadout<HTMLDivElement>()
  const total = values.filter((v) => v != null).length

  const s = useRef({
    x: REST, target: MAUMEE[0], touring: true, phase: "find" as Phase, clock: 0, dial: 0, idle: 0,
    scanned: values.map(() => false), springs: values.map((): Spring => ({ at: FLAT, rate: 0 })), drawn: values.map(() => -1),
  })

  const column = (x: number) => {
    const c = Math.round((x - columnX(0)) / (columnX(1) - columnX(0)))
    return c >= 0 && c < COLS && Math.abs(x - columnX(c)) < 9 ? c : -1
  }
  const columnMean = (c: number) => {
    const under = values.filter((v, i) => i % COLS === c && v != null) as number[]
    return under.length ? under.reduce((a, b) => a + b, 0) / under.length : null
  }

  const readout = () => {
    const { x, scanned } = s.current
    const done = scanned.filter((v, i) => v && values[i] != null).length
    if (x < MAP.x + MAP.w) {
      if (Math.abs(x - MAUMEE[0]) < 6) return "Maumee watershed · 41.2° N 84.5° W"
      const lon = lonOf(x)
      return `Imaging ${Math.abs(lon).toFixed(0)}° ${lon < 0 ? "W" : "E"} · Landsat + Sentinel-2`
    }
    if (x < TRAY.x) return `August weather · ${weather.temp.toFixed(1)} °C · ${weather.ppt.toFixed(0)} mm`
    const c = column(x), mean = c < 0 ? null : columnMean(c)
    return mean == null ? `${done} of ${total} cells mapped` : `Column ${c + 1} · ${mean.toFixed(2)} t/ha · ${done} of ${total} mapped`
  }

  const draw = () => {
    const st = s.current
    const shift = satShift(st.x)
    back.current?.setAttribute("transform", shift)
    front.current?.setAttribute("transform", shift)
    if (beam.current) beam.current.innerHTML = beamSvg(st.x)
    needle.current?.setAttribute("d", DIAL.needle(st.dial))
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
      const arrived = Math.abs(st.x - st.target) < 0.3
      if (st.phase === "find" && arrived) { st.phase = "dwell"; st.clock = 0 }
      else if (st.phase === "dwell" && st.clock > DWELL_S) { st.phase = "scan"; st.target = REACH[1] }
      else if (st.phase === "scan" && arrived) { st.phase = "hold"; st.clock = 0 }
      else if (st.phase === "hold" && st.clock > HOLD_S) { st.phase = "back"; st.target = REACH[0]; st.scanned = st.scanned.map(() => false) }
      else if (st.phase === "back" && arrived) { st.phase = "find"; st.target = MAUMEE[0] }
      const gap = st.target - st.x
      st.x = calm ? st.target : st.x + Math.sign(gap) * Math.min(Math.abs(gap), dt * SPEED * Math.min(1, 0.3 + Math.abs(gap) / 30))
    } else st.x = follow(st.x, st.target, dt, 0.25, calm)

    const c = column(st.x)
    if (c >= 0 && st.phase !== "back") values.forEach((_, i) => { if (i % COLS === c) st.scanned[i] = true })
    const mean = c < 0 ? null : columnMean(c)
    const share = mean == null ? 0 : (mean - GAUGE_RANGE[0]) / (GAUGE_RANGE[1] - GAUGE_RANGE[0])
    st.dial = follow(st.dial, Math.max(0, Math.min(1, share)), dt, 0.18, calm)

    let still = st.x === st.target && Math.abs(st.dial - share) < 1e-3
    values.forEach((v, i) => {
      if (v != null && !spring(st.springs[i], st.scanned[i] ? heightOf(v) : FLAT, dt, 140, 16, calm)) still = false
    })
    draw()
    return st.touring || !still
  }, inView)

  useEffect(() => {
    const st = s.current
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {   // one still, finished pose
      st.touring = false
      st.x = st.target = columnX(COLS - 1)
      st.scanned = st.scanned.map(() => true)
      st.springs.forEach((sp, i) => { if (values[i] != null) sp.at = heightOf(values[i]!) })
      st.dial = ((columnMean(COLS - 1) ?? GAUGE_RANGE[0]) - GAUGE_RANGE[0]) / (GAUGE_RANGE[1] - GAUGE_RANGE[0])
    }
    draw()
    return () => clearTimeout(st.idle)
  }, [])

  const steer = (x: number) => {
    const st = s.current
    st.touring = false
    st.target = Math.max(REACH[0], Math.min(REACH[1], x))
    clearTimeout(st.idle)
    st.idle = window.setTimeout(() => { st.touring = true; st.phase = "back"; st.target = REACH[0]; st.scanned = st.scanned.map(() => false); kick() }, 5000)
    kick()
  }
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const share = Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width - 0.12) / 0.76))
    steer(REACH[0] + share * (REACH[1] - REACH[0]))
  }
  const STOPS = [REACH[0], MAUMEE[0], (MAP.x + MAP.w + TRAY.x) / 2, ...Array.from({ length: COLS }, (_, c) => columnX(c))]
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const here = STOPS.reduce((best, x, i) => (Math.abs(x - s.current.target) < Math.abs(STOPS[best] - s.current.target) ? i : best), 0)
    const to = e.key === "ArrowRight" ? Math.min(STOPS.length - 1, here + 1) : e.key === "ArrowLeft" ? Math.max(0, here - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? STOPS.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    steer(STOPS[to])
  }

  return (
    <Plate fig="Fig 1" title="From orbit to a 30 m yield map" hint="Move across to steer the satellite" readout="Orbit · Landsat + Sentinel-2"
      keys={[{ mark: "lit", label: "Lens, its footprint and the reading" }, { mark: "raised", label: "Cells raised to predicted yield" }]}
      caption={CAPTION}>
      <div ref={(el) => { stage.current = el; anchor.current = el }} tabIndex={0} role="slider" aria-valuemin={0} aria-valuemax={STOPS.length - 1}
        aria-label="Orbit survey: arrow keys move the satellite from the world map to the Maumee watershed, the weather mast and each column of the crop patch"
        onPointerMove={onPointer} onKeyDown={onKey} className="outline-none">
        <IsoFigure width={WIDTH} height={HEIGHT} label="A bench with a dot-matrix world map, a weather mast, a crop patch of 30 field cells and a dial gauge, under an orbit arc. A satellite rides the arc; its lens footprint passes over the world, stops on the Maumee watershed, then crosses the patch, where each cell rises to its predicted 2019 corn yield and the dial shows it.">
          <path className="iso-halo" d={BASE.halo} />
          {BASE.feet.map((f, i) => <g key={i}><Solid paths={f.pad} tone="lo" /><Solid paths={f.foot} tone="mid" /></g>)}
          <Solid paths={BASE.plate} tone="mid" />
          <Line d={BASE.groove} tone="lo" />
          <Line d={BASE.screwRings} tone="lo" />
          <Dots points={BASE.screwDots} size={0.5} />
          <Solid paths={BASE.label} tone="lo" crease="none" />
          <Line d={BASE.labelRules} tone="faint" free />
          <Dots points={BASE.labelDots} size={0.45} />

          <Solid paths={MAST.gauge} tone="mid" inner={<Line d={MAST.gaugeMouth} tone="lo" />} />
          <Solid paths={MAST.pad} tone="mid" />
          <Dots points={MAST.padDots} size={0.4} />
          <Solid paths={MAST.low} tone="mid" crease="none" />
          <Solid paths={MAST.screen} tone="mid" inner={<Line d={MAST.louvres} tone="faint" />} />
          <Solid paths={MAST.high} tone="mid" crease="none" />
          <Solid paths={MAST.arm} tone="mid" />
          <Solid paths={MAST.vane} tone="mid" crease="none" />
          <Solid paths={MAST.hub} tone="mid" crease="none" />
          <Line d={MAST.spokes} tone="mid" />
          {MAST.cups.map((c, i) => <Solid key={i} paths={c} tone="mid" crease="none" />)}

          <path className="iso-halo" d={WORLD.halo} style={{ filter: "blur(3px)" }} />
          <Solid paths={WORLD.slab} tone="mid" />
          <Line d={WORLD.rim} tone="faint" />
          <Line d={WORLD.graticule} tone="faint" dotted />
          <Line d={WORLD.equator} tone="lo" />
          <Dots points={WORLD.rest} size={0.62} tone="mid" />
          <Dots points={WORLD.us} size={0.72} tone="hi" />
          <Line d={WORLD.maumeeRing} tone="lit" />
          <Dots points={[WORLD.maumee]} size={0.7} tone="hi" pulse />
          <Solid paths={WORLD.strip} tone="lo" crease="none" />
          <Line d={WORLD.ticks.minor} tone="lo" /><Line d={WORLD.ticks.major} tone="mid" />
          <Dots points={WORLD.stripDots} size={0.4} />

          <path className="iso-halo" d={PATCH.halo} style={{ filter: "blur(3px)" }} />
          <Solid paths={PATCH.tray} tone="mid" />
          <Line d={PATCH.rim} tone="faint" />
          <Line d={PATCH.sockets} tone="lo" />
          <Dots points={values.flatMap((v, i) => (v == null ? [PATCH.socketDot(i)] : []))} size={0.5} tone="lo" />
          {CELL_ORDER.map((i) => <g key={i} ref={(el) => { cells.current[i] = el }} />)}

          <Solid paths={DIAL.base} tone="lo" />
          <Solid paths={DIAL.body} tone="mid" inner={<><Line d={DIAL.bezel} tone="lo" /><Line d={DIAL.ticks.minor} tone="lo" /><Line d={DIAL.ticks.major} tone="mid" /></>} />
          <path ref={needle} className="iso-line" data-tone="lit" d={DIAL.needle(0)} />
          <Dots points={[DIAL.cap]} size={0.8} tone="hi" />

          <g ref={back}>
            <Solid paths={SAT.back.arm} tone="mid" crease="none" />
            <Solid paths={SAT.back.panel} tone="hi" inner={<Line d={SAT.back.grid} tone="lo" />} />
          </g>

          {ORBIT.posts.map((p, i) => (
            <g key={i}>
              <Solid paths={p.flange} tone="lo" />
              <Dots points={p.flangeDots} size={0.4} />
              <Solid paths={p.post} tone="mid" crease="none" inner={<Line d={p.seam} tone="faint" />} />
              <Solid paths={p.block} tone="mid" />
              <Dots points={[p.blockDot]} size={0.45} />
            </g>
          ))}
          <g className="iso-solid">
            <path className="iso-fill" d={ORBIT.outer} />
            <path className="iso-top" d={ORBIT.outer} />
            <path className="iso-fill" d={ORBIT.face} />
            <path className="iso-shade" data-shade="1" d={ORBIT.face} />
            <Line d={ORBIT.ticks} tone="lo" />
            <Line d={ORBIT.majors} tone="mid" />
            <path className="iso-line iso-edge" data-tone="mid" d={ORBIT.edge} />
          </g>

          <g ref={beam} />
          <g ref={front}>
            <Solid paths={SAT.hanger} tone="mid" crease="none" />
            <Solid paths={SAT.bus} tone="hi" inner={<Line d={SAT.busSeam} tone="faint" />} />
            <Dots points={SAT.busDots} size={0.4} />
            <Line d={SAT.antenna} tone="mid" />
            <Dots points={[SAT.antennaTip]} size={0.6} tone="hi" />
            <Solid paths={SAT.shroud} tone="mid" />
            <Solid paths={SAT.lens} tone="hi" lit inner={<Line d={SAT.lensRing} tone="lit" />} />
            <Solid paths={SAT.front.arm} tone="mid" crease="none" />
            <Solid paths={SAT.front.panel} tone="hi" inner={<Line d={SAT.front.grid} tone="lo" />} />
            <g className="iso-solid">
              <path className="iso-fill" d={SAT.wheel} />
              <path className="iso-line iso-edge" data-tone="mid" d={SAT.wheel} />
              <path className="iso-line" data-tone="lo" d={SAT.hub} />
            </g>
            <Dots points={[SAT.axle]} size={0.5} tone="hi" />
          </g>
        </IsoFigure>
      </div>
    </Plate>
  )
}
