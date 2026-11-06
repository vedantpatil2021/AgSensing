/**
 * Map layers straight from Cloud-Optimized GeoTIFFs (written by scripts/build_demo_data.py).
 *
 * The browser fetches only the 512 x 512 blocks a map tile needs (HTTP range requests). Zoomed in, it reads the
 * full-resolution image, so each 30 m pixel is drawn as a sharp square at any zoom; zoomed out, it reads the
 * GeoTIFF's own overviews. Colours are applied here from the stored values, and clicks read the exact pixel.
 */
import L from "leaflet"
import { fromUrl, type GeoTIFF, type GeoTIFFImage } from "geotiff"

type Level = { img: GeoTIFFImage; w: number; h: number; resX: number; resY: number }
type Source = { tiff: GeoTIFF; levels: Level[]; west: number; north: number; east: number; south: number }

const sources: Record<string, Promise<Source>> = {}

/** Open a GeoTIFF once (header only) and list its full-resolution image and overviews, finest first. */
export function openGeoTiff(url: string) {
  return (sources[url] ??= (async () => {
    const tiff = await fromUrl(url, { allowFullFile: false })
    const [west, south, east, north] = (await tiff.getImage(0)).getBoundingBox()
    const levels: Level[] = []
    for (let i = 0, n = await tiff.getImageCount(); i < n; i++) {
      const img = await tiff.getImage(i), w = img.getWidth(), h = img.getHeight()
      levels.push({ img, w, h, resX: (east - west) / w, resY: (north - south) / h })
    }
    levels.sort((a, b) => a.resX - b.resX)
    return { tiff, levels, west, north, east, south }
  })())
}

/** Stored value of the full-resolution pixel under a point, or null outside the image. */
export async function pixelAt(url: string, lat: number, lng: number) {
  const s = await openGeoTiff(url), l = s.levels[0]
  const col = Math.floor((lng - s.west) / l.resX), row = Math.floor((s.north - lat) / l.resY)
  if (col < 0 || row < 0 || col >= l.w || row >= l.h) return null
  const [band] = (await l.img.readRasters({ window: [col, row, col + 1, row + 1], samples: [0] })) as unknown as ArrayLike<number>[]
  return band[0]
}

export type GeoTiffStyle = { colors: string[]; min: number; max: number; scale: number; nodata: number }

/** Leaflet layer that draws one band of a GeoTIFF with a colour ramp (nearest pixel, no smoothing). */
export class GeoTiffLayer extends L.GridLayer {
  private url: string
  private style: GeoTiffStyle
  private lut: Uint32Array

  constructor(url: string, style: GeoTiffStyle, options?: L.GridLayerOptions) {
    super({ tileSize: 256, updateWhenZooming: false, keepBuffer: 4, ...options })
    this.url = url
    this.style = style
    this.lut = new Uint32Array(style.colors.map((hex) => {     // RGBA packed for a little-endian Uint32 view
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    }))
  }

  protected createTile(coords: L.Coords, done: L.DoneCallback) {
    const canvas = document.createElement("canvas")
    this.draw(canvas, coords).then(() => done(undefined, canvas), (e) => done(e, canvas))
    return canvas
  }

  private async draw(canvas: HTMLCanvasElement, coords: L.Coords) {
    const map = this._map, T = this.getTileSize().x, k = Math.min(2, Math.ceil(window.devicePixelRatio || 1)), N = T * k
    canvas.width = canvas.height = N
    canvas.style.width = canvas.style.height = `${T}px`
    const s = await openGeoTiff(this.url)
    const nw = map.unproject([coords.x * T, coords.y * T], coords.z), se = map.unproject([(coords.x + 1) * T, (coords.y + 1) * T], coords.z)
    if (se.lng <= s.west || nw.lng >= s.east || se.lat >= s.north || nw.lat <= s.south) return

    // coarsest image that still has at least one pixel per screen pixel (the full image when zoomed in)
    const step = (se.lng - nw.lng) / N
    let lv = s.levels[0]
    for (const l of s.levels) if (l.resX <= step) lv = l

    const cols = new Int32Array(N), rows = new Int32Array(N)
    for (let i = 0; i < N; i++) {
      cols[i] = Math.floor((nw.lng + (i + 0.5) * step - s.west) / lv.resX)
      rows[i] = Math.floor((s.north - map.unproject([coords.x * T, coords.y * T + (i + 0.5) / k], coords.z).lat) / lv.resY)  // Web Mercator rows
    }
    const x0 = Math.max(0, cols[0]), x1 = Math.min(lv.w, cols[N - 1] + 1), y0 = Math.max(0, rows[0]), y1 = Math.min(lv.h, rows[N - 1] + 1)
    if (x0 >= x1 || y0 >= y1) return
    const [data] = (await lv.img.readRasters({ window: [x0, y0, x1, y1], samples: [0] })) as unknown as ArrayLike<number>[]

    const { min, max, scale, nodata } = this.style, top = this.lut.length - 1
    const ctx = canvas.getContext("2d")!, out = ctx.createImageData(N, N), px = new Uint32Array(out.data.buffer)
    const width = x1 - x0
    for (let r = 0; r < N; r++) {
      const row = rows[r]
      if (row < y0 || row >= y1) continue
      const base = (row - y0) * width - x0
      for (let c = 0; c < N; c++) {
        const col = cols[c]
        if (col < x0 || col >= x1) continue
        const v = data[base + col]
        if (v === nodata) continue
        px[r * N + c] = this.lut[Math.round(Math.min(1, Math.max(0, (v / scale - min) / (max - min))) * top)]
      }
    }
    ctx.putImageData(out, 0, 0)
  }
}
