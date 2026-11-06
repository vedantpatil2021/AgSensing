import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import Editor, { type OnMount } from "@monaco-editor/react"
import { motion } from "motion/react"
import { CheckCircle2, ChevronRight, CircleHelp, Database, FileCode2, Globe, Layers, Loader2, MapPin, Play, Sparkles, Sprout, Upload, Wand2 } from "lucide-react"
import { Assistant } from "@/components/assistant"
import type L from "leaflet"
import { TextureButton } from "@/components/ui/texture-button"
import { TextureCard } from "@/components/ui/texture-card"
import { BasemapSwitch, CountiesToggle, LayersCard, Legend, MapView, type Basemap, type MapLayer } from "@/components/map"
import { Tip, Tour, seen, type TourStep } from "@/components/guide"
import { GeeDialog } from "@/components/gee-dialog"
import { Segmented } from "@/components/segmented"
import { SiteHeader } from "@/components/site-header"
import { YearTimeline } from "@/components/year-timeline"
import { FIRST_YEAR, HLS_FROM, LAST_YEAR, YEARS, modelFor, useCounties, useMeta, valueAt, type Crop, type Meta } from "@/lib/api"
import { countyAt, countyInfo, countyTipHtml } from "@/lib/county"
import { CROP_NAME, PROJECT, countyLabel, fmt } from "@/lib/constants"
import { LAYERS, layerKind, statements, stringsIn, studioScripts } from "@/lib/scripts"
import { cn } from "@/lib/utils"

type LogEntry =
  | { type: "cmd" | "note" | "error" | "text"; text: string; value?: string | number }
  | { type: "object"; label: string; value: Record<string, unknown> }
  | { type: "chart"; crop: Crop; year: number }
type Log = LogEntry & { id: number }
type Task = { id: number; desc: string; crop: Crop; year: number; state: "READY" | "RUNNING" | "COMPLETED"; progress: number }
type Status = { mode: "idle" | "running" | "done" | "error"; text?: string }

let uid = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ObjectTree({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true)
  if (value === null || typeof value !== "object")
    return <div className="pl-4 font-mono text-xs"><span className="text-muted-foreground">{label}: </span><span className="text-sky-700">{typeof value === "number" ? +value.toFixed(4) : String(value)}</span></div>
  return (
    <div className="font-mono text-xs">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-foreground"><ChevronRight size={12} className={cn("transition", open && "rotate-90")} />{label}</button>
      {open && <div className="ml-1.5 border-l pl-3">{Object.entries(value).map(([k, v]) => <ObjectTree key={k} label={k} value={v} />)}</div>}
    </div>
  )
}

/** Model vs USDA county yields; the chosen year is highlighted. */
function CountyChart({ meta, crop, year }: { meta: Meta; crop: Crop; year: number }) {
  const rows = meta.counties[crop]
  const [hover, setHover] = useState<(typeof rows)[number] | null>(null)
  const W = 320, H = 220, P = 32
  const vals = rows.flatMap((r) => [r.obs, r.pred]), lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals))
  const x = (v: number) => P + ((v - lo) / (hi - lo)) * (W - P - 8), y = (v: number) => H - P + 4 - ((v - lo) / (hi - lo)) * (H - P - 4)
  return (
    <TextureCard><div className="relative p-3">
      <div className="text-xs font-medium text-foreground">Model vs USDA county yield (t/ha), {year} highlighted</div>
      <svg width={W} height={H}>
        <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="#c9cfc8" strokeDasharray="4 4" />
        {[lo, (lo + hi) / 2, hi].map((t) => <g key={t} fontSize="9.5" fill="#8a948e"><text x={P - 6} y={y(t) + 3} textAnchor="end">{fmt(t, 1)}</text><text x={x(t)} y={H - 10} textAnchor="middle">{fmt(t, 1)}</text></g>)}
        {rows.map((r, i) => r.year !== year && <circle key={i} cx={x(r.obs)} cy={y(r.pred)} r={2.5} fill="#dfe4dd" />)}
        {rows.map((r, i) => r.year === year && <circle key={`s${i}`} cx={x(r.obs)} cy={y(r.pred)} r={hover === r ? 6 : 4.5} fill="#171717" stroke="#fff" strokeWidth={1.5} onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)} />)}
      </svg>
      {hover && <div className="pointer-events-none absolute rounded-lg border bg-white px-2 py-1 text-[11px] shadow" style={{ left: Math.min(x(hover.obs) + 10, W - 150), top: y(hover.pred) - 10 }}>{countyLabel(hover)}<br />USDA {fmt(hover.obs)} · model {fmt(hover.pred)}</div>}
    </div></TextureCard>
  )
}

function LogLine({ meta, log }: { meta: Meta; log: Log }) {
  if (log.type === "cmd") return <div className="pt-2 font-mono text-xs text-muted-foreground"><span className="text-emerald-700">❯</span> {log.text}</div>
  if (log.type === "error") return <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 font-mono text-xs text-red-700">{log.text}</div>
  if (log.type === "note") return <div className="text-xs text-muted-foreground">{log.text}</div>
  if (log.type === "object") return <ObjectTree label={log.label} value={log.value} />
  if (log.type === "chart") return <CountyChart meta={meta} crop={log.crop} year={log.year} />
  return <div className="font-mono text-xs text-foreground">{log.text}{log.value != null && <span className="text-sky-700"> {log.value}</span>}</div>
}

function ModelPanel({ meta, onPredict }: { meta: Meta; onPredict: (crop: Crop, year: number) => void }) {
  const [crop, setCrop] = useState<Crop>("corn")
  const [year, setYear] = useState(LAST_YEAR)
  const m = modelFor(meta, crop, year), sign = (v: number) => `${v < 0 ? "−" : "+"} ${Math.abs(v).toFixed(Math.abs(v) < 0.1 ? 4 : 2)}`
  return (
    <div className="space-y-4 text-sm">
      <p className="rounded-xl bg-neutral-100 px-3 py-2 text-emerald-700">No code needed: choose and press Predict.</p>
      <Segmented value={crop} onChange={setCrop} options={[["corn", "Corn"], ["soybean", "Soybean"]]} />
      <div className="grid grid-cols-6 gap-1">
        {YEARS.map((y) => <button key={y} onClick={() => setYear(y)} className={cn("rounded-lg border py-1 text-xs tabular-nums transition", y === year ? "border-neutral-900 bg-neutral-100 font-semibold" : "bg-white hover:border-neutral-400")}>{y}</button>)}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">Models · {year >= HLS_FROM ? `HLS, trained 2013–${LAST_YEAR}` : "HISTARFM, trained 2009–2019 (paper)"} <Tip text="Test R² is the share of county-to-county differences explained (1 is perfect). RMSE is the typical error in t/ha." /></div>
        {m.metrics.map((r) => (
          <div key={r.model} className={cn("rounded-xl border px-3 py-2", r.model === "MLR" ? "border-neutral-900 bg-neutral-50" : "bg-white")}>
            <div className="flex items-center text-foreground">{{ MLR: "Linear regression", RF: "Random forest", SVM: "SVM (radial)" }[r.model]}
              <span className="ml-auto text-[10px] font-semibold uppercase text-muted-foreground">{r.model === "MLR" ? "used for maps" : "compare"}</span></div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">test R² <b className="text-foreground">{fmt(r.test_R2)}</b> · RMSE <b className="text-foreground">{fmt(r.test_RMSE)}</b> t/ha</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-3 font-mono text-xs leading-5 text-foreground">
        yield = {fmt(m.intercept)}<br />&nbsp;&nbsp;{sign(m.coef["mean.NDVI"])}·NDVI {sign(m.coef["mean.EVI2"])}·EVI2<br />&nbsp;&nbsp;{sign(m.coef.mean_aug_temp)}·Temp {sign(m.coef.mean_aug_ppt)}·Rain
      </div>
      <TextureButton variant="primary" onClick={() => onPredict(crop, year)}><Sprout size={15} /> Predict yield map</TextureButton>
    </div>
  )
}

export default function Studio() {
  const meta = useMeta()
  const navigate = useNavigate()
  const scripts = useRef<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, string>>({})
  const [file, setFile] = useState("1_vegetation_index.py")
  const [left, setLeft] = useState<"scripts" | "models" | "assets">("scripts")
  const [right, setRight] = useState<"inspector" | "console" | "tasks">("console")
  const [chat, setChat] = useState(false)
  const [layers, setLayers] = useState<MapLayer[]>([])
  const [logs, setLogs] = useState<Log[]>([{ id: uid++, type: "note", text: "Output appears here. Press Run (⌘/Ctrl + Enter) to start." }])
  const [tasks, setTasks] = useState<Task[]>([])
  const [assets, setAssets] = useState<{ desc: string; crop: Crop; year: number }[]>([])
  const [status, setStatus] = useState<Status>({ mode: "idle" })
  const [inspect, setInspect] = useState<{ lat: number; lng: number; values: { name: string; unit: string; v: number | null }[]; county: string | null } | null>(null)
  const counties = useCounties()
  const [basemap, setBasemap] = useState<Basemap>("Map")
  const [showCounties, setShowCounties] = useState(true)
  const [predicted, setPredicted] = useState<{ crop: Crop; year: number } | null>(null)
  const [gee, setGee] = useState<{ crop: Crop; year: number } | null>(null)
  const [tour, setTour] = useState(() => !seen.get("ys_studio_tour"))
  const mapRef = useRef<L.Map | null>(null)
  const busy = useRef(false)
  const layersRef = useRef(layers)
  layersRef.current = layers

  useEffect(() => { if (meta) { scripts.current = studioScripts(meta); setFiles(scripts.current) } }, [meta])

  const log = (...entries: LogEntry[]) => setLogs((l) => [...l, ...entries.map((e) => ({ ...e, id: uid++ }))])
  const addLayer = (key: string, name: string, id = `l${uid++}`) =>
    setLayers((ls) => ls.some((l) => l.id === id) ? ls.map((l) => (l.id === id ? { ...l, key, name } : l)) : [...ls, { id, key, name, visible: true, opacity: 0.95 }])
  const finish = (t0: number, ok = true, text?: string) => {
    setStatus({ mode: ok ? "done" : "error", text: text ?? `Finished in ${((performance.now() - t0) / 1000).toFixed(1)} s` })
    setTimeout(() => setStatus({ mode: "idle" }), 2500)
    busy.current = false
  }
  const addTask = (desc: string, crop: Crop, year: number) => { setTasks((t) => [{ id: uid++, desc, crop, year, state: "READY", progress: 0 }, ...t]); setRight("tasks") }

  /* Demo runner: walks the script and turns Map / print / Export calls into layers, logs and tasks.
     The FastAPI backend will execute the code with earthengine-api instead. */
  const run = useCallback(async () => {
    if (!meta || busy.current) return
    busy.current = true
    setRight("console")
    const t0 = performance.now(), code = files[file]
    const crop = ((code.match(/\bcrop\s*=\s*["'](corn|soybean)["']/) || [])[1] || "corn") as Crop
    const year = +((code.match(/\byear\s*=\s*(\d{4})/) || [])[1] || LAST_YEAR)
    log({ type: "cmd", text: `python ${file}` })
    setStatus({ mode: "running", text: "Sending script to Earth Engine" })
    await sleep(400)
    if (year < FIRST_YEAR || year > LAST_YEAR) { log({ type: "error", text: `No data for ${year}: maps cover ${FIRST_YEAR}–${LAST_YEAR} (HISTARFM to 2019, HLS from ${HLS_FROM}).` }); return finish(t0, false, "Script error") }
    if (year >= HLS_FROM) log({ type: "note", text: `${year}: greenness from HLS (Landsat + Sentinel-2), model trained on HLS.` })
    for (const s of statements(code)) {
      if (/^ee\.Initialize/.test(s)) log({ type: "note", text: `Connected · project ${PROJECT}` })
      else if (/^Map\.centerObject/.test(s)) mapRef.current?.flyToBounds(meta.layers.yield_corn_2019.bounds, { padding: [30, 30], duration: 1 })
      else if (/^Map\.addLayer/.test(s)) {
        const kind = layerKind(s.split(",")[0]) ?? layerKind(s)
        if (!kind) { log({ type: "error", text: `No tiles for "${stringsIn(s).pop()}" in the demo.` }); continue }
        const info = LAYERS[kind](crop, year)
        if (!meta.layers[info.key]) { log({ type: "error", text: `No GeoTIFF for ${info.name}: the source file is missing from data/gee_export.` }); continue }
        setStatus({ mode: "running", text: `getMapId · ${info.band}` })
        await sleep(600)
        addLayer(info.key, info.name)
      } else if (/^print\(/.test(s)) {
        const label = stringsIn(s)[0] ?? "", kind = layerKind(s.slice(label.length + 8))
        await sleep(200)
        if (/\.size\(\)/.test(s)) log({ type: "text", text: label, value: 14 })
        else if (kind && /reduceRegion/.test(s)) {
          const info = LAYERS[kind](crop, year), st = meta.layers[info.key]?.stats
          if (!st) log({ type: "error", text: `No GeoTIFF for ${info.name}.` })
          else log({ type: "object", label, value: /mean\(\)/.test(s) ? { [info.band]: st.mean } : { [`${info.band}_min`]: st.min, [`${info.band}_max`]: st.max } })
        } else log({ type: "text", text: label })
      } else if (/Export\.image/.test(s)) {
        const desc = ((s.match(/description\s*=\s*f?["']([^"']+)/) || [])[1] ?? `${crop}_${year}`).replace("{crop}", crop).replace("{year}", String(year))
        addTask(desc, crop, year)
        log({ type: "note", text: `Task "${desc}" created. Start it in Tasks.` })
      }
    }
    finish(t0)
  }, [meta, files, file])
  const runRef = useRef(run)
  runRef.current = run

  const predict = async (crop: Crop, year: number) => {
    if (!meta || busy.current) return
    busy.current = true
    setRight("console")
    const t0 = performance.now(), st = meta.layers[`yield_${crop}_${year}`].stats, metric = modelFor(meta, crop, year).metrics[0]
    log({ type: "cmd", text: `predict --crop ${crop} --year ${year} --model MLR${year >= HLS_FROM ? " --source hls" : ""}` })
    for (const text of ["Building predictors", `Masking to ${crop} fields`, "Applying MLR to 30 m pixels"]) { setStatus({ mode: "running", text }); await sleep(500) }
    addLayer(`yield_${crop}_${year}`, `Predicted ${crop} yield ${year}`, "prediction")
    setPredicted({ crop, year })
    log({ type: "object", label: `${CROP_NAME[crop]} yield ${year}`, value: { mean_t_ha: st.mean, min_t_ha: st.min, max_t_ha: st.max, pixels_30m: st.n, test_R2: metric.test_R2, test_RMSE: metric.test_RMSE } },
      { type: "chart", crop, year })
    finish(t0)
  }

  const startTask = (id: number) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, state: "RUNNING", progress: 4 } : t)))
    const timer = setInterval(() => setTasks((ts) => ts.map((t) => {
      if (t.id !== id || t.state !== "RUNNING") return t
      const progress = Math.min(100, t.progress + 8 + Math.random() * 12)
      if (progress < 100) return { ...t, progress }
      clearInterval(timer)
      setAssets((a) => (a.some((x) => x.desc === t.desc) ? a : [...a, t]))
      return { ...t, state: "COMPLETED", progress }
    })), 350)
  }

  const onMapClick = async (lat: number, lng: number) => {
    if (!meta) return
    setRight("inspector")
    const visible = layersRef.current.filter((l) => l.visible).reverse()
    const values = await Promise.all(visible.map(async (l) => ({ name: l.name, unit: meta.palettes[meta.layers[l.key].kind].unit, v: await valueAt(meta, l.key, lat, lng) })))
    setInspect({ lat, lng, values, county: showCounties && counties ? countyAt(counties, lat, lng) : null })
  }
  const countyTip = (g: string) => countyTipHtml(countyInfo(meta!, counties!, g, predicted?.crop, predicted?.year), predicted?.crop, predicted?.year, "Predict a map in Models to see yields")

  const onMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
  }

  if (!meta || !files[file]) return null
  const top = [...layers].reverse().find((l) => l.visible)
  const steps: TourStep[] = [
    { target: "left", title: "Scripts and models", text: "Scripts from the repository, a no-code Models tab, and the maps you export.", before: () => setLeft("scripts") },
    { target: "editor", title: "Write and run", text: "Edit Python Earth Engine code, then press Run or ⌘/Ctrl + Enter. Try year = 2012." },
    { target: "right", title: "Results", text: "Console shows output and charts, Inspector shows values where you click the map, Tasks lists exports." },
    { target: "map", title: "Map", text: "Layers land here. Show, hide or fade them in the Layers card." },
    { target: "left", title: "No code needed", text: "Models predicts a 30 m yield map and checks it against USDA county yields.", before: () => setLeft("models") },
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SiteHeader sub="Studio · code + map">
        <div className={cn("hidden min-w-52 items-center gap-2 rounded-full border px-3 py-1.5 text-xs md:flex",
          status.mode === "running" ? "border-sky-200 bg-neutral-100-50" : status.mode === "error" ? "border-red-200 bg-red-50" : status.mode === "done" ? "border-emerald-200 bg-neutral-100" : "bg-white")}>
          {status.mode === "running" ? <Loader2 size={13} className="animate-spin" /> : status.mode === "idle" ? <span className="size-2 rounded-full bg-neutral-900" /> : <CheckCircle2 size={13} />}
          <motion.span key={status.text} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}>{status.mode === "idle" ? `Earth Engine · ${PROJECT}` : status.text}</motion.span>
        </div>
        <TextureButton variant="minimal" className="w-auto" onClick={() => setTour(true)}><CircleHelp size={15} /> Help</TextureButton>
        <TextureButton variant="minimal" className="w-auto" onClick={() => navigate("/explore")}><Wand2 size={15} /> Explore</TextureButton>
        <TextureButton variant="minimal" aria-pressed={chat} className={cn("w-auto", chat && "ring-2 ring-neutral-900/20")} onClick={() => setChat(!chat)}><Sparkles size={15} /> Assistant</TextureButton>
        <Tip below text={predicted ? "Code that shows this map in the Earth Engine Code Editor" : "Predict a map in Models first"}>
          <TextureButton variant="minimal" className="w-auto disabled:opacity-50" disabled={!predicted} onClick={() => setGee(predicted)}><Globe size={15} /> Show in GEE</TextureButton>
        </Tip>
        <TextureButton variant="primary" className="w-auto" onClick={run}><Play size={14} /> Run</TextureButton>
      </SiteHeader>

      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="grid min-h-0 grid-cols-[290px_minmax(0,1fr)_370px]" style={{ height: "45vh" }}>
        <aside data-tour="left" className="flex min-h-0 flex-col border-r bg-white">
          <Segmented className="m-2.5" value={left} onChange={setLeft} options={[["scripts", "Scripts"], ["models", "Models"], ["assets", `Assets${assets.length ? ` ${assets.length}` : ""}`]]} />
          <div className="flex-1 overflow-auto px-3 pb-4">
            {left === "scripts" && (
              <div className="space-y-1">
                {Object.keys(files).map((f) => (
                  <button key={f} onClick={() => setFile(f)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 font-mono text-xs transition", f === file ? "bg-neutral-100 text-foreground" : "text-muted-foreground hover:bg-muted")}>
                    <FileCode2 size={14} /> {f}{files[f] !== scripts.current[f] && <span className="ml-auto size-1.5 rounded-full bg-amber-500" title="edited" />}
                  </button>
                ))}
                <button onClick={() => setLeft("models")} className="mt-3 w-full rounded-xl border border-dashed p-3 text-left text-xs text-muted-foreground hover:border-neutral-400">
                  <span className="block font-medium text-foreground">Don't want to code?</span>Open Models and press Predict.
                </button>
              </div>
            )}
            {left === "models" && <ModelPanel meta={meta} onPredict={predict} />}
            {left === "assets" && (
              <div className="space-y-2">
                {assets.length === 0 && <p className="text-xs leading-relaxed text-muted-foreground">No saved maps yet. Run 3_predict_yield.py, then press Run on its task.</p>}
                {assets.map((a) => (
                  <div key={a.desc} className="rounded-xl border bg-white p-2.5">
                    <div className="flex items-center gap-2 font-mono text-xs"><Database size={13} /> yield/{a.desc}</div>
                    <div className="mt-2 flex gap-1.5">
                      <TextureButton variant="minimal" size="sm" className="w-auto" onClick={() => addLayer(`yield_${a.crop}_${a.year}`, `Asset · ${a.desc}`)}><Layers size={12} /> Add</TextureButton>
                      <TextureButton variant="minimal" size="sm" className="w-auto" onClick={() => setGee(a)}><Globe size={12} /> GEE</TextureButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section data-tour="editor" className="flex min-h-0 min-w-0 flex-col bg-white">
          <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-xs">
            <span className="rounded-md border bg-muted px-2 py-0.5 font-mono">{file}</span>
            <span className="text-muted-foreground">Python · earthengine-api</span>
            <button onClick={() => setFiles((f) => ({ ...f, [file]: scripts.current[file] }))} className="ml-auto text-muted-foreground hover:text-foreground">Reset</button>
            <button onClick={() => setLogs([])} className="ml-3 text-muted-foreground hover:text-foreground">Clear console</button>
          </div>
          <div className="min-h-0 flex-1">
            <Editor path={file} language="python" value={files[file]} onChange={(v) => setFiles((f) => ({ ...f, [file]: v ?? "" }))} onMount={onMount}
              options={{ fontSize: 12.5, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 10 } }} />
          </div>
        </section>

        <aside data-tour="right" className="flex min-h-0 flex-col border-l bg-white">
          <Segmented className="m-2.5" value={right} onChange={setRight} options={[["inspector", "Inspector"], ["console", "Console"], ["tasks", "Tasks"]]} />
          <div className="flex-1 space-y-1.5 overflow-auto px-3 pb-4">
            {right === "console" && logs.map((l) => <LogLine key={l.id} meta={meta} log={l} />)}
            {right === "inspector" && (!inspect
              ? <p className="text-xs text-muted-foreground">Click the map to read the visible layers at that spot.</p>
              : <>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground"><MapPin size={13} /> {fmt(inspect.lat, 5)}, {fmt(inspect.lng, 5)}</div>
                  {inspect.county && counties && (() => {
                    const c = countyInfo(meta, counties, inspect.county, predicted?.crop, predicted?.year)
                    return (
                      <div className="rounded-xl border bg-neutral-50 px-3 py-2 text-xs">
                        <div className="font-medium text-foreground">{c.label} <span className="font-normal text-muted-foreground">· GEOID {c.geoid} · {c.areaKm2.toLocaleString()} km²</span></div>
                        {!c.study
                          ? <div className="mt-1 text-muted-foreground">Outside the study area: no yield data.</div>
                          : predicted
                          ? <div className="mt-1 grid grid-cols-3 gap-2 tabular-nums">
                              {([["30 m map", c.mapMean], ["County model", c.model], ["USDA", c.usda]] as const).map(([t, v]) => (
                                <div key={t}><div className="text-muted-foreground">{t}</div><div className="font-semibold text-foreground">{v == null ? "—" : fmt(v, 2)}</div></div>))}
                            </div>
                          : <div className="mt-1 text-muted-foreground">Predict a map in Models to see this county's yields.</div>}
                      </div>)
                  })()}
                  {inspect.values.map((v) => (
                    <div key={v.name} className="rounded-xl border px-3 py-2">
                      <div className="truncate text-xs text-muted-foreground">{v.name}</div>
                      <div className="text-lg font-semibold">{v.v == null ? <span className="text-sm font-normal text-muted-foreground">no value here</span> : <>{fmt(v.v, v.unit === "mm" ? 0 : 2)} <span className="text-xs font-normal text-muted-foreground">{v.unit}</span></>}</div>
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground">Read from a ~360 m preview; the backend will return the 30 m pixel.</p>
                </>)}
            {right === "tasks" && (tasks.length === 0
              ? <p className="text-xs text-muted-foreground">No tasks yet. Exports from scripts land here, ready to run.</p>
              : tasks.map((t) => (
                <div key={t.id} className="rounded-xl border px-3 py-2.5">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className={cn("size-2 rounded-full", t.state === "COMPLETED" ? "bg-neutral-900" : t.state === "RUNNING" ? "animate-pulse bg-sky-500" : "bg-amber-400")} />{t.desc}
                    {t.state === "READY" ? <TextureButton variant="primary" size="sm" className="ml-auto w-auto" onClick={() => startTask(t.id)}><Upload size={12} /> Run</TextureButton>
                      : <span className="ml-auto text-[10px] font-semibold text-muted-foreground">{t.state}</span>}
                  </div>
                  {t.state !== "READY" && <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-neutral-900 transition-all" style={{ width: `${t.progress}%` }} /></div>}
                  {t.state === "COMPLETED" && <button className="mt-1.5 text-xs text-emerald-700 hover:underline" onClick={() => setGee(t)}>Saved to assets · show in GEE</button>}
                </div>
              )))}
          </div>
        </aside>
      </div>

      <div data-tour="map" className="relative min-h-0 flex-1 border-t">
        <MapView meta={meta} layers={layers} basemap={basemap} onClick={onMapClick} marker={inspect && [inspect.lat, inspect.lng]} mapRef={mapRef}
          counties={counties} selected={inspect?.county} countyTip={countyTip} showCounties={showCounties} />
        <div className="absolute right-3 top-3 z-[1000]"><LayersCard layers={layers} setLayers={setLayers} /></div>
        <div className="absolute bottom-6 left-3 z-[1000]"><Legend meta={meta} layer={top} /></div>
        {predicted && layers.some((l) => l.id === "prediction") && (
          <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2">
            <YearTimeline meta={meta} crop={predicted.crop} year={predicted.year} onYear={(y) => { addLayer(`yield_${predicted.crop}_${y}`, `Predicted ${predicted.crop} yield ${y}`, "prediction"); setPredicted({ ...predicted, year: y }) }} />
          </div>
        )}
        <div className="absolute bottom-16 right-3 z-[1000] flex flex-col items-end gap-2"><CountiesToggle checked={showCounties} onChange={setShowCounties} /><BasemapSwitch value={basemap} onChange={setBasemap} /></div>
      </div>
      </div>
      {chat && <Assistant meta={meta} context={{ page: "studio", crop: predicted?.crop, year: predicted?.year, county: inspect?.county }} onClose={() => setChat(false)} />}
      </div>

      {tour && <Tour steps={steps} onClose={() => { setTour(false); seen.set("ys_studio_tour"); setLeft("scripts") }} />}
      {gee && <GeeDialog meta={meta} crop={gee.crop} year={gee.year} onClose={() => setGee(null)} />}
    </div>
  )
}
