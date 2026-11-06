/**
 * Data access. Today it reads the static files written by scripts/build_demo_data.py (map layers are
 * Cloud-Optimized GeoTIFFs in public/cog/); the FastAPI backend will serve the same shapes.
 */
import { useEffect, useState } from "react"
import { pixelAt } from "./geotiff-layer"

export type Crop = "corn" | "soybean"
export type Bounds = [[number, number], [number, number]]
export type Stats = { mean: number; min: number; max: number; n: number }
/** A map layer: a GeoTIFF whose stored integers are value x scale, with nodata where there is no crop. */
export type Layer = { kind: string; url: string; bounds: Bounds; stats: Stats; scale: number; nodata: number; source: "HISTARFM" | "HLS" | "PRISM" }
export type Palette = { colors: string[]; min: number; max: number; unit: string }
export type CountyRow = { GEOID: number; name: string; year: number; obs: number; pred: number }
export type Metric = { model: "MLR" | "RF" | "SVM"; test_R2: number; test_RMSE: number; test_MAE: number }
export type Model = { intercept: number; coef: Record<string, number>; metrics: Metric[] }
export type ForecastRow = { horizon: number; n: number; RMSE: number; R2: number; bias: number; within_year_r: number }
export type Meta = {
  years: number[]
  /** First year mapped with HLS greenness and the HLS-trained model (earlier years: HISTARFM and the paper model) */
  hlsFrom: number
  layers: Record<string, Layer>
  palettes: Record<string, Palette>
  counties: Record<Crop, CountyRow[]>
  models: Record<Crop, Model>
  modelsHls: Record<Crop, Model>
  /** Forward test of the HLS model: trained on years up to T, scored on T+1..T+3 */
  forecast: Record<Crop, ForecastRow[]>
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
export const YEARS = Array.from({ length: 17 }, (_, i) => 2009 + i)     // 2009-2025; must match meta.years
export const HLS_FROM = 2020
export const FIRST_YEAR = YEARS[0], LAST_YEAR = YEARS[YEARS.length - 1]
/** The model (and satellite source) behind a year's map. */
export const modelFor = (meta: Meta, crop: Crop, year: number) => (year >= meta.hlsFrom ? meta.modelsHls[crop] : meta.models[crop])
export const sourceOf = (year: number) => (year >= HLS_FROM ? "HLS" : "HISTARFM")

/** Value of the full-resolution 30 m pixel under a point (read from the layer's GeoTIFF), or null where there is no data. */
export async function valueAt(meta: Meta, key: string, lat: number, lng: number) {
  const layer = meta.layers[key]
  if (!layer) return null
  const v = await pixelAt(layer.url, lat, lng)
  return v == null || v === layer.nodata ? null : v / layer.scale
}
