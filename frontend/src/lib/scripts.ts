/** Studio scripts, the statement walker used by the demo runner, and Code Editor snippets. */
import type { Crop, Meta } from "./api"
import { FIPS, PROJECT, fmt } from "./constants"

const fipsList = JSON.stringify(FIPS).replace(/,/g, ", ")

export function studioScripts(meta: Meta): Record<string, string> {
  const m = meta.models.corn
  return {
    "1_vegetation_index.py": `# July-August NDVI / EVI2 on corn or soybean fields (HISTARFM, 30 m).
# Map and print work like the Code Editor; the backend turns them into map tiles and console output.
import ee
ee.Initialize(project="${PROJECT}")

crop = "corn"      # "corn" or "soybean"
year = 2019        # 2009-2019

counties = ee.FeatureCollection("TIGER/2018/Counties").filter(ee.Filter.inList("GEOID", ${fipsList}))
print("Counties selected:", counties.size())

def indices(img):
    img = img.select(["B3_mean_post", "B4_mean_post"], ["Red", "NIR"]).multiply(0.0001)
    ndvi = img.normalizedDifference(["NIR", "Red"]).rename("NDVI")
    evi2 = img.expression("2.5 * (NIR - RED) / (NIR + 2.4 * RED + 1)",
                          {"NIR": img.select("NIR"), "RED": img.select("Red")}).rename("EVI2")
    return ee.Image.cat([ndvi, evi2])

cropland = ee.Image(ee.ImageCollection("USDA/NASS/CDL")
                    .filter(ee.Filter.eq("system:index", str(year))).first()).select("cropland")
veg = (ee.ImageCollection("projects/KalmanGFwork/GFLandsat_V1")
       .filter(ee.Filter.eq("year", year)).filter(ee.Filter.inList("month", [7, 8]))
       .map(indices).reduce(ee.Reducer.mean())
       .updateMask(cropland.eq({"corn": 1, "soybean": 5}[crop])))

Map.centerObject(counties, 9)
Map.addLayer(veg.select("NDVI_mean"), {"min": 0.55, "max": 0.9}, "NDVI Jul-Aug")
print("NDVI stats:", veg.select("NDVI_mean").reduceRegion(ee.Reducer.minMax(), counties, 30))
`,
    "2_weather.py": `# August mean temperature and total precipitation (PRISM daily, ~4 km).
import ee
ee.Initialize(project="${PROJECT}")

year = 2019

start = ee.Date.fromYMD(year, 8, 1)
days = ee.ImageCollection("OREGONSTATE/PRISM/ANd").filterDate(start, start.advance(1, "month"))
temp = days.select("tmean").mean().rename("mean_aug_temp")
ppt = days.select("ppt").sum().rename("mean_aug_ppt")

Map.addLayer(ppt, {"min": 20, "max": 200}, "Aug total precipitation")
Map.addLayer(temp, {"min": 20, "max": 25}, "Aug mean temperature")
print("Temperature stats:", temp.reduceRegion(ee.Reducer.minMax(), counties, 4638))
print("Precipitation stats:", ppt.reduceRegion(ee.Reducer.minMax(), counties, 4638))
`,
    "3_predict_yield.py": `# 30-m yield map: the final MLR model from 2_modeling/train_models.py, applied inside Earth Engine.
import ee
ee.Initialize(project="${PROJECT}")

crop = "corn"
year = 2019

# vegetation(), weather() and counties are the same as in scripts 1 and 2
b = {"b0": ${fmt(m.intercept, 4)}, "ndvi": ${fmt(m.coef["mean.NDVI"], 4)}, "evi2": ${fmt(m.coef["mean.EVI2"], 4)},
     "temp": ${fmt(m.coef.mean_aug_temp, 5)}, "ppt": ${fmt(m.coef.mean_aug_ppt, 5)}}

predictors = vegetation(crop, year).addBands(weather(year))
yield_map = predictors.expression(
    "b0 + ndvi * NDVI_mean + evi2 * EVI2_mean + temp * mean_aug_temp + ppt * mean_aug_ppt",
    {**b, **{n: predictors.select(n) for n in predictors.bandNames().getInfo()}}).max(0)

Map.addLayer(yield_map, {"min": 6, "max": 12.5}, "Predicted yield (t/ha)")
print("Yield stats:", yield_map.reduceRegion(ee.Reducer.mean(), counties, 30))

ee.batch.Export.image.toAsset(image=yield_map, description=f"{crop}_{year}_mlr",
                              assetId=f"projects/${PROJECT}/assets/yield/{crop}_{year}_mlr", scale=30)
`,
  }
}

/** Split Python into statements (balanced brackets; strings and comments skipped). */
export function statements(code: string) {
  const out: string[] = []
  let cur = "", depth = 0, quote: string | null = null
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (quote) { cur += ch; if (ch === quote && code[i - 1] !== "\\") quote = null; continue }
    if (ch === "#") { while (i < code.length && code[i] !== "\n") i++; i--; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if ("([{".includes(ch)) depth++
    if (")]}".includes(ch)) depth--
    if (ch === "\n" && depth <= 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; depth = 0; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export type LayerKind = "yield" | "ndvi" | "temp" | "ppt"
export const layerKind = (s: string): LayerKind | null => {
  const t = s.toLowerCase()
  return t.includes("yield") ? "yield" : t.includes("ndvi") ? "ndvi" : /ppt|precip|rain/.test(t) ? "ppt" : t.includes("temp") ? "temp" : null
}
export const stringsIn = (s: string) => [...s.matchAll(/f?"([^"]*)"|f?'([^']*)'/g)].map((m) => m[1] ?? m[2])

export const LAYERS: Record<LayerKind, (crop: Crop, year: number) => { key: string; name: string; band: string }> = {
  yield: (crop, year) => ({ key: `yield_${crop}_${year}`, name: `Predicted ${crop} yield ${year}`, band: "yield" }),
  ndvi: (crop, year) => ({ key: `ndvi_${crop}_${year}`, name: `NDVI Jul–Aug ${year} (${crop})`, band: "NDVI_mean" }),
  temp: (_, year) => ({ key: `temp_${year}`, name: `Aug mean temperature ${year}`, band: "mean_aug_temp" }),
  ppt: (_, year) => ({ key: `ppt_${year}`, name: `Aug total precipitation ${year}`, band: "mean_aug_ppt" }),
}

/** JavaScript for the Earth Engine Code Editor that shows the same map. */
export function codeEditorSnippet(meta: Meta, crop: Crop, year: number, mode: "asset" | "recompute") {
  const m = meta.models[crop], pal = meta.palettes[`yield_${crop}`]
  const palette = JSON.stringify(pal.colors.filter((_, i) => i % 8 === 0).concat(pal.colors[63])).replace(/"/g, "'")
  const vis = `{min: ${pal.min}, max: ${pal.max}, palette: ${palette}}`
  const head = `var counties = ee.FeatureCollection('TIGER/2018/Counties')
  .filter(ee.Filter.inList('GEOID', ${fipsList.replace(/"/g, "'")}));
Map.centerObject(counties, 9);
`
  if (mode === "asset") return `// Loads the map exported from Yield Studio
${head}var yieldMap = ee.Image('projects/${PROJECT}/assets/yield/${crop}_${year}_mlr');
Map.addLayer(yieldMap, ${vis}, '${crop} yield ${year} (t/ha)');`
  return `// Recomputes the same map from scratch (needs HISTARFM access)
${head}var YEAR = ${year};
var cropland = ee.Image(ee.ImageCollection('USDA/NASS/CDL')
  .filter(ee.Filter.eq('system:index', String(YEAR))).first()).select('cropland');
var veg = ee.ImageCollection('projects/KalmanGFwork/GFLandsat_V1')
  .filter(ee.Filter.eq('year', YEAR)).filter(ee.Filter.inList('month', [7, 8]))
  .map(function (img) {
    img = img.select(['B3_mean_post', 'B4_mean_post'], ['Red', 'NIR']).multiply(0.0001);
    return ee.Image.cat([
      img.normalizedDifference(['NIR', 'Red']).rename('NDVI'),
      img.expression('2.5 * (NIR - RED) / (NIR + 2.4 * RED + 1)',
        {NIR: img.select('NIR'), RED: img.select('Red')}).rename('EVI2')]);
  }).reduce(ee.Reducer.mean())
  .updateMask(cropland.eq(${crop === "corn" ? 1 : 5}));
var start = ee.Date.fromYMD(YEAR, 8, 1);
var prism = ee.ImageCollection('OREGONSTATE/PRISM/ANd').filterDate(start, start.advance(1, 'month'));
var weather = prism.select('tmean').mean().rename('T').addBands(prism.select('ppt').sum().rename('P'));

// Final MLR model from v2.0
var yieldMap = veg.addBands(weather).expression(
  '${fmt(m.intercept, 4)} + (${fmt(m.coef["mean.NDVI"], 4)}) * N + (${fmt(m.coef["mean.EVI2"], 4)}) * E + (${fmt(m.coef.mean_aug_temp, 5)}) * T + (${fmt(m.coef.mean_aug_ppt, 5)}) * P',
  {N: veg.select('NDVI_mean'), E: veg.select('EVI2_mean'), T: weather.select('T'), P: weather.select('P')})
  .max(0).clip(counties);
Map.addLayer(yieldMap, ${vis}, '${crop} yield ${year} (t/ha)');`
}
