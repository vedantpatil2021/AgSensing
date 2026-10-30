/**
 * Data access. Today it reads the static files written by scripts/build_demo_data.py;
 * the FastAPI backend will serve the same shapes (map tiles from Earth Engine getMapId).
 */
import { useEffect, useState } from "react"

export type Crop = "corn" | "soybean"
export type Bounds = [[number, number], [number, number]]
export type Stats = { mean: number; min: number; max: number; n: number }
export type Layer = { kind: string; url: string; bounds: Bounds; stats: Stats }
export type Palette = { colors: string[]; min: number; max: number; unit: string }
export type CountyRow = { GEOID: number; name: string; year: number; obs: number; pred: number }
export type Metric = { model: "MLR" | "RF" | "SVM"; test_R2: number; test_RMSE: number; test_MAE: number }
export type Model = { intercept: number; coef: Record<string, number>; metrics: Metric[] }
export type Meta = {
  layers: Record<string, Layer>
  palettes: Record<string, Palette>
  counties: Record<Crop, CountyRow[]>
  models: Record<Crop, Model>
  scan: { crop: Crop; year: number; cols: number; rows: number; values: (number | null)[] }
  /** Each county's mean of the 30-m map: countyMaps[crop][year][GEOID] = [t/ha, pixels] */
  countyMaps: Record<Crop, Record<string, Record<string, [number, number]>>>
}

let metaPromise: Promise<Meta> | null = null
/** A file in public/, under the site's base path ("/" locally, "/AgSensing/" on GitHub Pages). */
export const asset = (path: string) => import.meta.env.BASE_URL + path.replace(/^\//, "")
export const loadMeta = () => (metaPromise ??= fetch(asset("demo/meta.json")).then((r) => r.json()).then((meta: Meta) => {
  Object.values(meta.layers).forEach((layer) => { layer.url = asset(layer.url) })
  return meta
}))

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null)
  useEffect(() => { loadMeta().then(setMeta) }, [])
  return meta
}

let countiesPromise: Promise<GeoJSON.FeatureCollection> | null = null
export function useCounties() {
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null)
  useEffect(() => { (countiesPromise ??= fetch(asset("data/us_counties.geojson")).then((r) => r.json())).then(setFc) }, [])
  return fc
}

export const paletteOf = (meta: Meta, key: string) => meta.palettes[meta.layers[key].kind]
export const yearMeans = (meta: Meta, crop: Crop) => YEARS.map((y) => meta.layers[`yield_${crop}_${y}`].stats.mean)
export const YEARS = Array.from({ length: 11 }, (_, i) => 2009 + i)

/* Pixel value under a point: read the layer image and invert its palette. */
const pixels: Record<string, Promise<ImageData>> = {}
function loadPixels(url: string) {
  return (pixels[url] ??= new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, img.width, img.height))
    }
    img.src = url
  }))
}

export async function valueAt(meta: Meta, key: string, lat: number, lng: number) {
  const layer = meta.layers[key]
  const [[s, w], [n, e]] = layer.bounds
  if (lat < s || lat > n || lng < w || lng > e) return null
  const px = await loadPixels(layer.url)
  const col = Math.min(px.width - 1, Math.floor(((lng - w) / (e - w)) * px.width))
  const row = Math.min(px.height - 1, Math.floor(((n - lat) / (n - s)) * px.height))
  const i = (row * px.width + col) * 4
  if (px.data[i + 3] === 0) return null
  const pal = meta.palettes[layer.kind]
  let best = 0, bestDist = Infinity
  pal.colors.forEach((hex, j) => {
    const d = [1, 3, 5].reduce((sum, k, c) => sum + (parseInt(hex.slice(k, k + 2), 16) - px.data[i + c]) ** 2, 0)
    if (d < bestDist) { bestDist = d; best = j }
  })
  return pal.min + (best / (pal.colors.length - 1)) * (pal.max - pal.min)
}
