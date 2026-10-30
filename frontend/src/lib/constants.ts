import type { Crop } from "./api"

export const PROJECT = "ee-agsensing-lab"
export const BU_PER_T: Record<Crop, number> = { corn: 1 / 0.06277, soybean: 1 / 0.06725 } // t/ha -> bu/acre
export const STATE: Record<string, string> = { "18": "IN", "26": "MI", "39": "OH" }
export const CROP_NAME: Record<Crop, string> = { corn: "Corn", soybean: "Soybean" }
export const YEAR_NOTES: Record<number, string> = { 2012: "Drought year", 2019: "Very wet spring" }
export const FIPS = ["18001", "18003", "18033", "26059", "39003", "39011", "39039",
  "39051", "39063", "39069", "39125", "39137", "39161", "39171"]

export const fmt = (v: number | null | undefined, d = 2) => (v == null || isNaN(v) ? "—" : v.toFixed(d))
export const countyLabel = (r: { GEOID: number; name: string }) => `${r.name} County, ${STATE[String(r.GEOID).slice(0, 2)]}`
