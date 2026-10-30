import type { Crop, Meta } from "./api"
import { CROP_NAME, STATE, fmt } from "./constants"

export type CountyInfo = { geoid: string; label: string; areaKm2: number; study: boolean; mapMean?: number; usda?: number; model?: number }

/** Everything we know about one county for a crop and year. */
export function countyInfo(meta: Meta, counties: GeoJSON.FeatureCollection, geoid: string, crop?: Crop | null, year?: number | null): CountyInfo {
  const p = counties.features.find((f) => f.properties!.GEOID === geoid)!.properties!
  const info: CountyInfo = { geoid, label: `${p.NAME}, ${STATE[geoid.slice(0, 2)] ?? p.STATE}`, areaKm2: p.area_km2, study: p.study }
  if (p.study) info.label = `${p.NAME} County, ${STATE[geoid.slice(0, 2)]}`
  if (p.study && crop && year) {
    info.mapMean = meta.countyMaps[crop][year]?.[geoid]?.[0]
    const row = meta.counties[crop].find((r) => String(r.GEOID) === geoid && r.year === year)
    if (row) { info.usda = row.obs; info.model = row.pred }
  }
  return info
}

/** Hover card on the map (plain HTML for a Leaflet tooltip). */
export function countyTipHtml(info: CountyInfo, crop?: Crop | null, year?: number | null, empty = "Pick a crop and a year to see yields") {
  const rows = !info.study
    ? `<div class="mt-1 text-muted-foreground">Outside the study area · no yield data</div>`
    : crop && year
    ? `<div class="mt-1 text-muted-foreground">${CROP_NAME[crop]} ${year}</div>
       <div>30 m map average: <b>${fmt(info.mapMean, 2)} t/ha</b></div>
       <div>USDA reported: <b>${info.usda == null ? "not published" : `${fmt(info.usda, 2)} t/ha`}</b></div>`
    : `<div class="mt-1 text-muted-foreground">${empty}</div>`
  return `<div class="font-semibold">${info.label}</div>${rows}<div class="mt-1 text-muted-foreground">${info.areaKm2.toLocaleString()} km²${info.study ? " · click for details" : ""}</div>`
}

/** GEOID of the county containing a point (ray casting over each ring). */
export function countyAt(counties: GeoJSON.FeatureCollection, lat: number, lng: number) {
  const inside = (ring: number[][]) => {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit
    }
    return hit
  }
  for (const f of counties.features) {
    const g = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates
    if (polys.some((rings) => inside(rings[0]) && !rings.slice(1).some(inside))) return f.properties!.GEOID as string
  }
  return null
}
