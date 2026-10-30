import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { Bean, Check, ChevronRight, CircleHelp, Code2, Loader2, MousePointerClick, Wheat, X } from "lucide-react"
import type L from "leaflet"
import { NeumorphEyebrow } from "@/components/ui/neumorph-eyebrow"
import { RollingNumber } from "@/components/ui/rolling-number"
import { TextureButton } from "@/components/ui/texture-button"
import { TextureCard } from "@/components/ui/texture-card"
import { BasemapSwitch, CountiesToggle, Legend, MapView, type Basemap, type MapLayer } from "@/components/map"
import { Tip, Tour, seen, type TourStep } from "@/components/guide"
import { GeeDialog } from "@/components/gee-dialog"
import { SiteHeader } from "@/components/site-header"
import { YearTimeline } from "@/components/year-timeline"
import { YEARS, useCounties, useMeta, valueAt, yearMeans, type Crop, type Meta } from "@/lib/api"
import { countyAt, countyInfo, countyTipHtml } from "@/lib/county"
import { BU_PER_T, CROP_NAME, YEAR_NOTES, countyLabel, fmt } from "@/lib/constants"
import { cn } from "@/lib/utils"

const CROPS: { id: Crop; Icon: typeof Wheat; sub: string; bg: string }[] = [
  { id: "corn", Icon: Wheat, sub: "Field corn for grain", bg: "bg-white" },
  { id: "soybean", Icon: Bean, sub: "Soybeans for grain", bg: "bg-white" },
]

function Step({ n, title, done, tip, tour, children }: { n: number; title: string; done: boolean; tip?: string; tour: string; children: React.ReactNode }) {
  return (
    <TextureCard data-tour={tour}>
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <span className={cn("flex size-7 items-center justify-center rounded-full text-sm font-semibold transition", done ? "bg-neutral-900 text-primary-foreground" : "bg-muted text-foreground")}>{done ? <Check size={14} /> : n}</span>
          <span className="font-medium text-foreground">{title}</span>
          {tip && <Tip text={tip} />}
        </div>
        {children}
      </div>
    </TextureCard>
  )
}

function Results({ meta, crop, year, county, setCounty, counties: fc }: { meta: Meta; crop: Crop; year: number; county: string; setCounty: (g: string) => void; counties: GeoJSON.FeatureCollection }) {
  const st = meta.layers[`yield_${crop}_${year}`].stats
  const means = yearMeans(meta, crop), avg = means.reduce((a, b) => a + b) / means.length
  const diff = ((st.mean - avg) / avg) * 100
  const metric = meta.models[crop].metrics[0]
  const rows = meta.counties[crop]
  const counties = [...new Map(rows.map((r) => [String(r.GEOID), countyLabel(r)])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const info = countyInfo(meta, fc, county, crop, year)
  const bars = ([["USDA official", info.usda, "bg-sky-500"], ["County model", info.model, "bg-neutral-900"], ["30 m map average", info.mapMean, "bg-emerald-600"]] as const)
    .filter(([, v]) => v != null) as unknown as [string, number, string][]
  const top = Math.max(...bars.map(([, v]) => v)) * 1.1
  const name = CROP_NAME[crop].toLowerCase()

  return (
    <>
      <TextureCard>
        <div className="p-5">
          <NeumorphEyebrow intent="secondary">Your result</NeumorphEyebrow>
          <div className="mt-3 text-sm text-muted-foreground">Average {name} yield in {year}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight leading-none text-foreground"><RollingNumber value={st.mean} precision={1} format={(v) => v.toFixed(1)} /></span>
            <span className="text-sm text-muted-foreground">tonnes per hectare</span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">≈ <b className="text-foreground"><RollingNumber value={Math.round(st.mean * BU_PER_T[crop])} /></b> bushels per acre</div>
          <div className={cn("mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", diff >= 0 ? "bg-neutral-100 text-emerald-700" : "bg-red-50 text-red-700")}>
            {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(0)}% {diff >= 0 ? "above" : "below"} the 2009–2019 average
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-foreground">
            {[["Fields mapped", `${Math.round((st.n * 0.09) / 1000)}k ha`, "All crop pixels: 30 m × 30 m = 0.09 ha each."],
              ["Best year", YEARS[means.indexOf(Math.max(...means))], "Highest average yield."],
              ["Worst year", YEARS[means.indexOf(Math.min(...means))], "Lowest average yield."]].map(([t, v, tip]) => (
              <Tip key={t} text={tip} className="w-full"><div className="w-full rounded-xl bg-muted px-2.5 py-2"><div className="text-[11px] text-muted-foreground">{t}</div><div className="font-semibold">{v}</div></div></Tip>
            ))}
          </div>
        </div>
      </TextureCard>

      <TextureCard>
        <div className="p-5">
          <div className="flex items-center gap-2 font-medium text-foreground">Check a county <Tip text="USDA publishes official yields per county from farmer surveys. Compare them with the model's county estimate and with the average of the 30 m map inside the county." /></div>
          <p className="mt-0.5 text-xs">Choose below, or click a county on the map.</p>
          <select value={county} onChange={(e) => setCounty(e.target.value)} className="mt-3 w-full rounded-xl border bg-white px-3 py-2.5 text-foreground outline-none focus:ring-2 focus:ring-neutral-300">
            {counties.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <div className="mt-3 space-y-2">
            {bars.map(([t, v, c]) => (
              <div key={t}>
                <div className="flex justify-between text-sm"><span>{t}</span><b className="tabular-nums text-foreground">{fmt(v, 2)} t/ha</b></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted"><motion.div className={cn("h-full rounded-full", c)} animate={{ width: `${(v / top) * 100}%` }} /></div>
              </div>
            ))}
            {info.usda != null && info.model != null
              ? <p className="text-sm">{Math.abs(info.model - info.usda) / info.usda < 0.07 ? "The model is very close to the official number." : Math.abs(info.model - info.usda) / info.usda < 0.15 ? "The model is fairly close to the official number." : "The model is off by more than 15% for this county and year."}</p>
              : <p className="text-sm">USDA did not publish a {name} yield for this county in {year}.</p>}
            <p className="text-xs">{info.areaKm2.toLocaleString()} km² of land.</p>
          </div>
        </div>
      </TextureCard>

      <TextureCard>
        <div className="p-5">
          <div className="flex items-center gap-2 font-medium text-foreground">How accurate is this? <Tip text={`Tested on counties the model never saw. R² = ${fmt(metric.test_R2)}: it explains about ${Math.round(metric.test_R2 * 100)}% of the differences between counties.`} /></div>
          <p className="mt-2 text-sm leading-relaxed">County estimates are usually within <b className="text-foreground">±{fmt(metric.test_RMSE, 1)} t/ha</b> (about ±{Math.round(metric.test_RMSE * BU_PER_T[crop])} bu/acre) of USDA numbers. Single fields can be off by more.</p>
          <div className="mt-3 flex gap-1">{Array.from({ length: 10 }, (_, i) => <div key={i} className={cn("h-2 flex-1 rounded-full", i < Math.round(metric.test_R2 * 10) ? "bg-neutral-900" : "bg-muted")} />)}</div>
          <div className="mt-1 flex justify-between text-[11px]"><span>rough guess</span><span>perfect</span></div>
        </div>
      </TextureCard>
    </>
  )
}

export default function Explore() {
  const meta = useMeta()
  const navigate = useNavigate()
  const [crop, setCrop] = useState<Crop | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>("Map")
  const [showCounties, setShowCounties] = useState(true)
  const [inspect, setInspect] = useState<{ lat: number; lng: number; v: number | null; county: string | null } | null>(null)
  const counties = useCounties()
  const [county, setCounty] = useState<string | null>(null)
  const [gee, setGee] = useState(false)
  const [tour, setTour] = useState(() => !seen.get("ys_explore_tour"))
  const mapRef = useRef<L.Map | null>(null)

  const ready = crop !== null && year !== null
  const key = ready ? `yield_${crop}_${year}` : ""
  const layers: MapLayer[] = shown && ready ? [{ id: "yield", key, name: `${CROP_NAME[crop]} yield in ${year}`, visible: true, opacity: 0.95 }] : []

  useEffect(() => {     // the map follows crop and year once it is shown
    if (!shown) return
    setLoading(true); setInspect(null)
    const t = setTimeout(() => setLoading(false), 400)
    return () => clearTimeout(t)
  }, [crop, year])

  if (!meta) return null
  const means = crop ? yearMeans(meta, crop) : []
  const show = () => { setLoading(true); setTimeout(() => { setShown(true); setLoading(false) }, 700) }
  const onMapClick = async (lat: number, lng: number) => {
    const g = showCounties && counties ? countyAt(counties, lat, lng) : null
    const inStudy = g != null && meta.counties.corn.some((r) => String(r.GEOID) === g)
    if (inStudy) setCounty(g)
    if (key && shown) setInspect({ lat, lng, v: await valueAt(meta, key, lat, lng), county: g })
  }
  const shownCrop = shown ? crop : null, shownYear = shown ? year : null
  const countyTip = (g: string) => countyTipHtml(countyInfo(meta, counties!, g, shownCrop, shownYear), shownCrop, shownYear)
  const level = (v: number) => {
    const pal = meta.palettes[`yield_${crop}`], f = (v - pal.min) / (pal.max - pal.min)
    return f < 0.34 ? ["Lower than most fields", "bg-red-50 text-red-700"] : f < 0.67 ? ["About average", "bg-amber-50 text-amber-700"] : ["Higher than most fields", "bg-neutral-100 text-emerald-700"]
  }
  const steps: TourStep[] = [
    { target: "crop", title: "First, pick a crop", text: "Corn or soybean. The map shows only fields of that crop." },
    { target: "year", title: "Then pick a year", text: "Any season from 2009 to 2019. The small bars show how good each year was; 2012 was a drought." },
    { target: "show", title: "Show the map", text: "Press the button once. After that the map follows whatever crop or year you pick." },
    { target: "map", title: "Read the map", text: "Green is higher yield, red is lower. Hover or click a county for its numbers (untick County boundaries to hide them), click a field for its yield, or press play to watch every year." },
    { target: "studio", title: "Go further in Studio", text: "For researchers: write Python Earth Engine code, run the yield models on any year, inspect pixels and export maps. Your Explore map is always one click back." },
    { target: "help", title: "Help is always here", text: "The small ? marks explain terms in plain words. Help replays this tour." },
  ]

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <SiteHeader sub="Explore · yield maps">
        <span data-tour="help"><TextureButton variant="minimal" className="w-auto" onClick={() => setTour(true)}><CircleHelp size={15} /> Help</TextureButton></span>
        <Tip below text="Write Earth Engine code, export maps and more."><span data-tour="studio" className="block"><TextureButton variant="minimal" className="w-auto" onClick={() => navigate("/studio")}><Code2 size={15} /> Studio</TextureButton></span></Tip>
      </SiteHeader>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[440px_1fr]">
        <div className="space-y-3 p-4 text-muted-foreground sm:p-5 lg:overflow-auto">
          <div className="px-1 pb-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">How much did the fields produce?</h1>
            <p className="mt-1 text-sm">Maumee River Watershed, estimated from satellites and weather.</p>
          </div>

          <Step n={1} title="Pick a crop" done={!!crop} tour="crop">
            <div className="grid grid-cols-2 gap-2.5">
              {CROPS.map(({ id, Icon, sub, bg }) => (
                <button key={id} onClick={() => setCrop(id)} className={cn("relative rounded-2xl border p-4 text-left transition hover:-translate-y-0.5", bg, crop === id ? "border-transparent ring-2 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400")}>
                  <Icon size={26} className="text-foreground" strokeWidth={1.5} />
                  <div className="mt-2 font-medium text-foreground">{CROP_NAME[id]}</div>
                  <div className="text-xs">{sub}</div>
                  {crop === id && <span className="absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full bg-neutral-900 text-white"><Check size={12} /></span>}
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title="Pick a year" done={!!year} tour="year" tip="Bar height shows how good the harvest was that year. Pick a crop first to see the bars.">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {YEARS.map((y, i) => (
                <button key={y} onClick={() => setYear(y)} title={YEAR_NOTES[y]}
                  className={cn("flex flex-col items-center rounded-xl border pb-1 pt-1.5 transition hover:-translate-y-0.5", y === year ? "border-neutral-900 bg-neutral-100 text-foreground" : "bg-white hover:border-neutral-400")}>
                  <span className="flex h-5 items-end">{crop && <span className={cn("w-4 rounded-sm", y === 2012 ? "bg-amber-500" : "bg-neutral-300")} style={{ height: 4 + ((means[i] - Math.min(...means)) / (Math.max(...means) - Math.min(...means))) * 16 }} />}</span>
                  <span className="mt-0.5 text-sm font-medium tabular-nums">{y}</span>
                </button>
              ))}
            </div>
            {year && YEAR_NOTES[year] && <p className="mt-2 text-sm">{year}: {YEAR_NOTES[year].toLowerCase()} in this region.</p>}
          </Step>

          <div data-tour="show">
            {!shown
              ? <TextureButton variant="primary" size="lg" disabled={!ready || loading} onClick={show} className="disabled:opacity-50">
                  <span className="flex items-center gap-2 py-1">{loading ? <><Loader2 size={16} className="animate-spin" /> Making your map…</> : ready ? `Show ${CROP_NAME[crop].toLowerCase()} yield for ${year}` : "Show the yield map"}</span>
                </TextureButton>
              : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-neutral-100 px-3 py-2.5 text-sm text-emerald-700"><Check size={15} /> The map updates by itself. Try another crop or year.</div>}
            {!ready && <p className="mt-1.5 text-center text-xs">{!crop ? "Pick a crop to continue" : "Pick a year to continue"}</p>}
          </div>

          {shown && ready && counties && <Results meta={meta} crop={crop} year={year} county={county ?? "39003"} setCounty={setCounty} counties={counties} />}
          {shown && ready && <button onClick={() => setGee(true)} className="flex w-full items-center justify-center gap-1 py-2 text-sm hover:text-foreground">For advanced users: open this map in Google Earth Engine <ChevronRight size={14} /></button>}
        </div>

        <div data-tour="map" className="relative h-[70vh] min-h-[420px] lg:h-auto">
          <MapView meta={meta} layers={layers} basemap={basemap} onClick={onMapClick} marker={inspect && [inspect.lat, inspect.lng]} mapRef={mapRef}
            counties={counties} selected={county} countyTip={countyTip} showCounties={showCounties} />
          {!shown && <div className="glass absolute bottom-6 left-1/2 z-[1000] w-max max-w-[calc(100%-24px)] -translate-x-1/2 px-4 py-2.5 text-sm text-muted-foreground md:max-w-[calc(100%-440px)]"><b className="font-medium text-foreground">Your map will appear here.</b> Pick a crop and a year, then press Show the yield map.</div>}
          {loading && <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-white/40"><div className="glass flex items-center gap-2 px-4 py-3 text-sm"><Loader2 size={15} className="animate-spin" /> Making your map…</div></div>}
          <AnimatePresence>
            {shown && !loading && (
              <motion.div key={inspect ? `${inspect.lat}${inspect.lng}` : "hint"} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="glass absolute left-1/2 top-3 z-[1000] -translate-x-1/2 px-4 py-2.5">
                {inspect?.county && counties && (() => { const c = countyInfo(meta, counties, inspect.county, crop, year); return (
                  <div className="mb-1.5 border-b pb-1.5 pr-6 text-xs"><b className="text-foreground">{c.label}</b> · {c.study ? `county average ${fmt(c.mapMean, 2)} t/ha` : "outside the study area"}</div>) })()}
                {!inspect ? <span className="flex items-center gap-2 text-sm"><MousePointerClick size={15} /> Click any field or county to see its yield</span>
                  : inspect.v == null ? <span className="pr-6 text-sm">No {CROP_NAME[crop!].toLowerCase()} fields here in {year}. Try a coloured spot.</span>
                  : <div className="pr-6">
                      <div className="text-xs text-muted-foreground">Yield at this spot</div>
                      <div><span className="text-2xl font-semibold tracking-tight">{fmt(inspect.v, 1)}</span> <span className="text-sm text-muted-foreground">t/ha · ≈ {Math.round(inspect.v * BU_PER_T[crop!])} bu/acre</span></div>
                      <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold", level(inspect.v)[1])}>{level(inspect.v)[0]}</span>
                    </div>}
                {inspect && <button onClick={() => setInspect(null)} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"><X size={14} /></button>}
              </motion.div>
            )}
          </AnimatePresence>
          {shown && ready && <div className="absolute bottom-6 left-3 z-[1000]"><Legend meta={meta} layer={layers[0]} plain /></div>}
          {shown && ready && <div className="absolute bottom-24 left-1/2 z-[1000] hidden -translate-x-1/2 md:block lg:bottom-6"><YearTimeline meta={meta} crop={crop} year={year} onYear={setYear} /></div>}
          <div className="absolute bottom-16 right-3 z-[1000] flex flex-col items-end gap-2"><CountiesToggle checked={showCounties} onChange={setShowCounties} /><BasemapSwitch value={basemap} onChange={setBasemap} /></div>
        </div>
      </main>

      {tour && <Tour steps={steps} onClose={() => { setTour(false); seen.set("ys_explore_tour") }} />}
      {gee && ready && <GeeDialog meta={meta} crop={crop} year={year} onClose={() => setGee(false)} />}
    </div>
  )
}
