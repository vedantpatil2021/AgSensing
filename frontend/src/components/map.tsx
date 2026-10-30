import L from "leaflet"
import { useEffect, useRef, useState } from "react"
import { ChevronRight, Layers, Loader2, MapPin, Search, X } from "lucide-react"
import type { Bounds, Meta } from "@/lib/api"
import { cn } from "@/lib/utils"

export type MapLayer = { id: string; key: string; name: string; visible: boolean; opacity: number }

const esri = (service: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`
/** Base tiles under the data, label tiles over it (so place names stay readable on top of a yield map). */
const ESRI = "Tiles &copy; Esri"
/** All free, no key. Map, Terrain and Satellite mirror Google's three map types. */
export const BASEMAPS: Record<"Map" | "Terrain" | "Satellite" | "Plain", { base: string; labels: string[]; credit: string }> = {
  Map: { base: esri("World_Street_Map"), labels: [], credit: ESRI },
  Terrain: { base: esri("World_Topo_Map"), labels: [], credit: ESRI },
  Satellite: { base: esri("World_Imagery"), labels: [esri("Reference/World_Transportation"), esri("Reference/World_Boundaries_and_Places")], credit: ESRI },
  Plain: { base: esri("Canvas/World_Light_Gray_Base"), labels: [esri("Canvas/World_Light_Gray_Reference")], credit: ESRI },
}
export type Basemap = keyof typeof BASEMAPS

const COUNTY_STYLE = { color: "#374151", weight: 1.2, opacity: 0.9, fillColor: "#2563eb", fillOpacity: 0 }
const OTHER_STYLE = { color: "#4b5563", weight: 0.8, opacity: 0.75, fillColor: "#2563eb", fillOpacity: 0 }     // counties outside the study area
const COUNTY_HOVER = { color: "#111827", weight: 2.4, fillOpacity: 0.06 }
const COUNTY_SELECTED = { color: "#2563eb", weight: 3, fillOpacity: 0.1 }

type Props = {
  meta: Meta
  layers: MapLayer[]
  basemap: Basemap
  onClick: (lat: number, lng: number) => void
  marker?: [number, number] | null
  mapRef?: React.RefObject<L.Map | null>
  counties?: GeoJSON.FeatureCollection | null
  selected?: string | null
  onCounty?: (geoid: string) => void
  countyTip?: (geoid: string) => string
  showCounties?: boolean
}

export function MapView({ meta, layers, basemap, onClick, marker, mapRef, counties, selected, onCounty, countyTip, showCounties = false }: Props) {
  const div = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const overlays = useRef<Record<string, { key: string; ov: L.ImageOverlay }>>({})
  const base = useRef<L.TileLayer[]>([])
  const countyLayer = useRef<L.GeoJSON | null>(null)
  const hovered = useRef<string | null>(null)
  const countyRef = useRef({ selected, onCounty, countyTip, basemap })
  countyRef.current = { selected, onCounty, countyTip, basemap }
  const pin = useRef<L.CircleMarker | null>(null)
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const study = meta.layers.yield_corn_2019.bounds as Bounds

  useEffect(() => {
    const m = L.map(div.current!, { zoomControl: false, maxZoom: 16 }).setView([41.2, -84.4], 8)
    L.control.zoom({ position: "topleft" }).addTo(m)
    L.control.scale({ position: "bottomright" }).addTo(m)
    m.createPane("counties").style.zIndex = "450"     // above the yield overlays (400)
    const labels = m.createPane("labels")
    labels.style.zIndex = "460"
    labels.style.pointerEvents = "none"
    m.on("click", (e) => clickRef.current(e.latlng.lat, e.latlng.lng))
    map.current = m
    if (mapRef) mapRef.current = m
    let fitted = false
    const ro = new ResizeObserver(() => {     // fit once the container has a real size
      m.invalidateSize()
      if (!fitted && div.current!.offsetHeight > 0) { fitted = true; m.fitBounds(study, { padding: [30, 30] }) }
    })
    ro.observe(div.current!)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    base.current.forEach((t) => t.remove())
    const { base: url, labels, credit } = BASEMAPS[basemap]
    base.current = [
      L.tileLayer(url, { attribution: credit, maxZoom: 16 }).addTo(map.current!),
      ...labels.map((u) => L.tileLayer(u, { pane: "labels", maxZoom: 16 }).addTo(map.current!)),
    ]
    base.current[0].bringToBack()
  }, [basemap])

  const studyIds = useRef(new Set<string>())
  const styleOf = (geoid: string) => {
    const onImagery = countyRef.current.basemap === "Satellite"     // white lines read better on imagery
    const base = studyIds.current.has(geoid) ? COUNTY_STYLE : OTHER_STYLE
    const rest = onImagery ? { ...base, color: "#ffffff" } : base
    if (geoid === countyRef.current.selected) return { ...rest, ...COUNTY_SELECTED, ...(onImagery && { color: "#60a5fa" }) }
    return geoid === hovered.current ? { ...rest, ...COUNTY_HOVER, ...(onImagery && { color: "#ffffff" }) } : rest
  }

  useEffect(() => {
    if (!counties) return
    studyIds.current = new Set(counties.features.filter((f) => f.properties!.study).map((f) => f.properties!.GEOID))
    const layer = L.geoJSON(counties, {
      pane: "counties",
      ...({ renderer: L.canvas({ pane: "counties", tolerance: 2 }) } as L.GeoJSONOptions),     // ~3,000 shapes: canvas keeps panning smooth
      style: (f) => styleOf(f!.properties.GEOID),
      onEachFeature: (f, l) => {
        const geoid: string = f.properties.GEOID
        l.bindTooltip("", { sticky: true, direction: "top", offset: [0, -8], className: "county-tip" })
        l.on("mouseover", () => {
          hovered.current = geoid
          ;(l as L.Path).setStyle(styleOf(geoid))
          l.setTooltipContent(countyRef.current.countyTip?.(geoid) ?? f.properties.NAME)
        })
        l.on("mouseout", () => { hovered.current = null; (l as L.Path).setStyle(styleOf(geoid)) })
        l.on("click", () => countyRef.current.onCounty?.(geoid))
      },
    })
    countyLayer.current = layer
    return () => { layer.remove(); countyLayer.current = null }
  }, [counties])

  useEffect(() => {     // the boundaries are drawn only while their layer is ticked
    const layer = countyLayer.current
    if (!layer) return
    if (showCounties) layer.addTo(map.current!)
    else { hovered.current = null; layer.remove() }
  }, [showCounties, counties])

  useEffect(() => {     // restyle when the selection changes
    countyLayer.current?.eachLayer((l) => (l as L.Path).setStyle(styleOf(((l as L.GeoJSON).feature as GeoJSON.Feature).properties!.GEOID)))
  }, [selected, basemap])

  useEffect(() => {
    const ids = new Set(layers.map((l) => l.id))
    for (const [id, o] of Object.entries(overlays.current)) if (!ids.has(id)) { o.ov.remove(); delete overlays.current[id] }
    layers.forEach((l, i) => {
      let o = overlays.current[l.id]
      if (!o || o.key !== l.key) {
        o?.ov.remove()
        const layer = meta.layers[l.key]
        o = overlays.current[l.id] = { key: l.key, ov: L.imageOverlay(layer.url, layer.bounds, { interactive: false }).addTo(map.current!) }
      }
      o.ov.setOpacity(l.visible ? l.opacity : 0)
      o.ov.setZIndex(10 + i)
    })
  }, [layers])

  useEffect(() => {
    pin.current?.remove()
    pin.current = marker ? L.circleMarker(marker, { radius: 7, color: "#171717", weight: 2.5, fillColor: "#fff", fillOpacity: 1 }).addTo(map.current!) : null
  }, [marker?.[0], marker?.[1]])

  return (
    <div className="absolute inset-0">
      <div ref={div} className="h-full w-full" />
      <div className="absolute left-14 top-2.5 z-[1000]"><PlaceSearch map={map} /></div>
    </div>
  )
}

type Place = { display_name: string; lat: string; lon: string; boundingbox: [string, string, string, string] }

/** Google-style place search, using OpenStreetMap's free Nominatim service (no key; at most one request a second). */
function PlaceSearch({ map }: { map: React.RefObject<L.Map | null> }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const pin = useRef<L.Marker | null>(null)

  const search = async () => {
    if (q.trim().length < 3) return
    setBusy(true)
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q=${encodeURIComponent(q.trim())}`
      setResults(await (await fetch(url, { headers: { "Accept-Language": "en" } })).json())
    } catch { setResults([]) }
    setBusy(false)
  }
  const go = (p: Place) => {
    const [s, n, w, e] = p.boundingbox.map(Number)
    map.current?.flyToBounds([[s, w], [n, e]], { maxZoom: 14, duration: 1 })
    pin.current?.remove()
    pin.current = L.marker([+p.lat, +p.lon], {
      icon: L.divIcon({ className: "", html: '<div class="place-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }),
    }).addTo(map.current!)
    setQ(p.display_name.split(",")[0])
    setResults(null)
  }
  const clear = () => { setQ(""); setResults(null); pin.current?.remove(); pin.current = null }

  return (
    <div className="w-72 max-w-[calc(100vw-6rem)]">
      <form onSubmit={(e) => { e.preventDefault(); search() }} className="flex items-center gap-2 rounded-full border bg-white px-3.5 py-2 shadow-md">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a place or address" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        {busy ? <Loader2 size={14} className="animate-spin text-muted-foreground" /> : q && <button type="button" onClick={clear} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>}
      </form>
      {results && (
        <div className="mt-1.5 overflow-hidden rounded-xl border bg-white shadow-md">
          {results.length === 0 && <div className="px-3.5 py-2.5 text-sm text-muted-foreground">No places found.</div>}
          {results.map((p) => (
            <button key={p.lat + p.lon} onClick={() => go(p)} className="flex w-full items-start gap-2 px-3.5 py-2 text-left text-sm hover:bg-muted">
              <MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="line-clamp-2">{p.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Legend({ meta, layer, plain }: { meta: Meta; layer?: MapLayer; plain?: boolean }) {
  if (!layer) return null
  const pal = meta.palettes[meta.layers[layer.key].kind]
  return (
    <div className="glass w-60 px-3.5 py-3">
      <div className="mb-2 truncate text-xs font-medium">{layer.name}</div>
      <div className="h-3 rounded-full" style={{ background: `linear-gradient(90deg, ${pal.colors.filter((_, i) => i % 4 === 0).join(",")})` }} />
      {plain && <div className="mt-1.5 flex justify-between text-xs font-medium"><span className="text-red-600">Lower yield</span><span className="text-emerald-700">Higher yield</span></div>}
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums"><span>{pal.min}</span><span>{pal.unit}</span><span>{pal.max}</span></div>
    </div>
  )
}

export function CountiesToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="glass flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-neutral-900" />
      County boundaries
    </label>
  )
}

export function BasemapSwitch({ value, onChange }: { value: Basemap; onChange: (b: Basemap) => void }) {
  return (
    <div className="glass flex gap-1 p-1">
      {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
        <button key={b} onClick={() => onChange(b)}
          className={cn("rounded-lg px-2.5 py-1 text-xs transition", b === value ? "bg-neutral-900 font-medium text-white" : "text-muted-foreground hover:bg-muted")}>{b}</button>
      ))}
    </div>
  )
}

export function LayersCard({ layers, setLayers }: { layers: MapLayer[]; setLayers: React.Dispatch<React.SetStateAction<MapLayer[]>> }) {
  const [open, setOpen] = useState(true)
  const update = (id: string, patch: Partial<MapLayer>) => setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  return (
    <div className="glass w-64 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium">
        <Layers size={14} /> Layers <span className="font-normal text-muted-foreground">({layers.length})</span>
        <ChevronRight size={14} className={cn("ml-auto transition", open && "rotate-90")} />
      </button>
      {open && (
        <div className="max-h-56 overflow-auto border-t">
          {layers.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">Run a script or a model and its layers show up here.</p>}
          {[...layers].reverse().map((l) => (
            <div key={l.id} className="border-b px-3 py-2 last:border-0">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={l.visible} onChange={(e) => update(l.id, { visible: e.target.checked })} className="accent-neutral-900" />
                <span className="flex-1 truncate text-xs" title={l.name}>{l.name}</span>
                <button onClick={() => setLayers((ls) => ls.filter((x) => x.id !== l.id))} className="text-muted-foreground hover:text-red-600" title="Remove"><X size={13} /></button>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={l.opacity} onChange={(e) => update(l.id, { opacity: +e.target.value })} className="mt-1 h-1 w-full accent-neutral-900" title="Transparency" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
