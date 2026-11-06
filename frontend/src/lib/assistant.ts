/**
 * Assistant preview: no model is called yet. Replies are written in the browser from the same demo data the maps use
 * (meta.json), so every number is real; the backend will swap this for a Claude API call with the same inputs.
 */
import { FIRST_YEAR, HLS_FROM, LAST_YEAR, YEARS, yearMeans, type Crop, type Meta } from "./api"
import { BU_PER_T, CROP_NAME, YEAR_NOTES, countyLabel, fmt } from "./constants"

export const MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Deepest analysis", think: 1.6, speed: 0.75 },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Fast and capable", think: 1, speed: 1 },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "Quickest answers", think: 0.5, speed: 1.5 },
] as const
export type ModelId = (typeof MODELS)[number]["id"]

export type AssistantContext = { page: "explore" | "studio"; crop?: Crop | null; year?: number | null; county?: string | null }
export type Reply = { thought: string; text: string }

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const pct = (v: number, base: number) => `${Math.abs(((v - base) / base) * 100).toFixed(0)}% ${v >= base ? "above" : "below"}`
const bu = (tHa: number, crop: Crop) => Math.round(tHa * BU_PER_T[crop])

/** The single suggestion shown on an empty chat. */
export function starter(meta: Meta) {
  const means = yearMeans(meta, "corn")
  return `Why was ${YEARS[means.indexOf(Math.min(...means))]} the weakest corn year?`
}

function season(meta: Meta, crop: Crop, year: number) {
  return { ndvi: meta.layers[`ndvi_${crop}_${year}`]?.stats.mean, temp: meta.layers[`temp_${year}`]?.stats.mean, ppt: meta.layers[`ppt_${year}`]?.stats.mean }
}

function yearReport(meta: Meta, crop: Crop, year: number): Reply {
  const st = meta.layers[`yield_${crop}_${year}`].stats, means = yearMeans(meta, crop), w = season(meta, crop, year)
  const allNdvi = avg(YEARS.map((y) => season(meta, crop, y).ndvi)), allTemp = avg(YEARS.map((y) => season(meta, crop, y).temp)), allPpt = avg(YEARS.map((y) => season(meta, crop, y).ppt))
  const rank = [...means].sort((a, b) => b - a).indexOf(st.mean) + 1
  return {
    thought: `Read the ${year} ${crop} map statistics and that season's July–August greenness and August weather.`,
    text: [
      `**${CROP_NAME[crop]}, ${year}:** the 30 m map averages **${fmt(st.mean)} t/ha** (about ${bu(st.mean, crop)} bu/acre), ${pct(st.mean, avg(means))} the ${FIRST_YEAR}–${LAST_YEAR} average. It ranks **${rank} of ${YEARS.length}** years.`,
      "",
      `- Mapped: ${Math.round((st.n * 0.09) / 1000)}k ha of ${crop} fields at 30 m`,
      `- July–August NDVI: ${fmt(w.ndvi)} (average year ${fmt(allNdvi)})`,
      `- August: ${fmt(w.temp, 1)} °C and ${fmt(w.ppt, 0)} mm of rain (average ${fmt(allTemp, 1)} °C and ${fmt(allPpt, 0)} mm)`,
      ...(YEAR_NOTES[year] ? [`- Note: ${YEAR_NOTES[year].toLowerCase()} in this region`] : []),
      "",
      `Greenness carries most of the signal in this model, so a season with weaker canopy in late summer shows up as lower yield.`,
    ].join("\n"),
  }
}

function extremes(meta: Meta, crop: Crop, why: boolean): Reply {
  const means = yearMeans(meta, crop), best = YEARS[means.indexOf(Math.max(...means))], worst = YEARS[means.indexOf(Math.min(...means))]
  const line = (y: number) => { const w = season(meta, crop, y); return `NDVI ${fmt(w.ndvi)}, August ${fmt(w.temp, 1)} °C and ${fmt(w.ppt, 0)} mm` }
  const order = YEARS.map((y, i) => [y, means[i]] as const).sort((a, b) => b[1] - a[1])
  return {
    thought: `Compared the average ${crop} yield of all eleven maps, then pulled greenness and August weather for the best and worst seasons.`,
    text: [
      `For ${crop}, **${best}** was the strongest year at **${fmt(Math.max(...means))} t/ha** and **${worst}** the weakest at **${fmt(Math.min(...means))} t/ha**, a gap of ${pct(Math.min(...means), Math.max(...means)).split(" ")[0]}.`,
      "",
      `- ${best}: ${line(best)}`,
      `- ${worst}: ${line(worst)}${YEAR_NOTES[worst] ? ` (${YEAR_NOTES[worst].toLowerCase()})` : ""}`,
      "",
      why
        ? `The difference comes mostly from canopy greenness: the model weights July–August NDVI and EVI2 heavily, and ${worst} had ${season(meta, crop, worst).ndvi < season(meta, crop, best).ndvi ? "a visibly weaker" : "a similar"} canopy. August heat and rain shift the estimate further, since grain fill happens then.`
        : `Ranking, best to worst: ${order.map(([y]) => y).join(", ")}.`,
    ].join("\n"),
  }
}

function countyReport(meta: Meta, crop: Crop, geoid: string, year: number): Reply {
  const rows = meta.counties[crop].filter((r) => String(r.GEOID) === geoid)
  const label = countyLabel(rows[0] ?? { GEOID: +geoid, name: geoid })
  const row = rows.find((r) => r.year === year), map = meta.countyMaps[crop][year]?.[geoid]?.[0]
  if (!row) return {
    thought: `Looked up ${label} in the USDA county yields for ${year}.`,
    text: `USDA did not publish a ${crop} yield for **${label}** in ${year}, so there is nothing official to compare against.${map ? ` The 30 m map still averages **${fmt(map)} t/ha** inside the county.` : ""}`,
  }
  const err = ((row.pred - row.obs) / row.obs) * 100
  return {
    thought: `Matched ${label} to the USDA ${crop} yields, the county model and the 30 m map average for ${year}.`,
    text: [
      `**${label}, ${crop} ${year}**`,
      "",
      `- USDA official: **${fmt(row.obs)} t/ha** (${bu(row.obs, crop)} bu/acre)`,
      `- County model: ${fmt(row.pred)} t/ha`,
      ...(map != null ? [`- 30 m map average: ${fmt(map)} t/ha`] : []),
      "",
      `The model is ${Math.abs(err).toFixed(1)}% ${err >= 0 ? "above" : "below"} the official number, ${Math.abs(err) < 7 ? "a close match" : Math.abs(err) < 15 ? "reasonably close" : "a larger miss than usual"}. Across all ${rows.length} years in this county the average miss is ${fmt(avg(rows.map((r) => Math.abs(r.pred - r.obs))))} t/ha.`,
    ].join("\n"),
  }
}

function accuracy(meta: Meta, crop: Crop): Reply {
  const m = meta.models[crop].metrics, best = [...m].sort((a, b) => b.test_R2 - a.test_R2)[0]
  return {
    thought: `Read the held-out test scores of the three ${crop} models.`,
    text: [
      `On counties and years held out from training, the ${crop} models score:`,
      "",
      ...m.map((r) => `- **${r.model}**: R² ${fmt(r.test_R2)}, typical error ±${fmt(r.test_RMSE)} t/ha (±${bu(r.test_RMSE, crop)} bu/acre)`),
      "",
      `From ${HLS_FROM} the maps use HLS satellite data and an MLR trained on HLS (2013–${LAST_YEAR}). In a forward test (train on past years, predict the next season) its typical county error is ±${fmt(meta.forecast[crop][0]?.RMSE)} t/ha.`,
      "",
      `The maps use **MLR** (multiple linear regression) because it is simple enough to apply to every 30 m pixel${best.model === "MLR" ? " and it also scores best here" : `, even though ${best.model} scores a little higher on this test`}. Single fields can be off by more than the county-level error.`,
    ].join("\n"),
  }
}

function method(meta: Meta, crop: Crop): Reply {
  const { intercept, coef } = meta.models[crop]
  return {
    thought: "Summarised the method of KC & Khanal (2023) and the fitted coefficients.",
    text: [
      `The maps follow KC & Khanal (2023). USDA publishes yield per **county**, not per field, so the model learns from counties and is then applied to every **30 m pixel**:`,
      "",
      `- Satellite: July–August NDVI and EVI2 from gap-filled Landsat (HISTARFM) for 2009–2019 and from HLS (Landsat + Sentinel-2) for ${HLS_FROM}–${LAST_YEAR}, on ${crop} fields only (USDA Cropland Data Layer)`,
      `- Weather: August mean temperature and total rain (PRISM)`,
      `- Training: 14 Maumee counties against USDA NASS yields (2009–2019 for the HISTARFM model, 2013–${LAST_YEAR} for the HLS model)`,
      "",
      `The fitted ${crop} equation (t/ha) is ${fmt(intercept)}${Object.entries(coef).map(([k, v]) => ` ${v < 0 ? "−" : "+"} ${fmt(Math.abs(v), 3)} × ${k.replace("mean.", "").replace("mean_aug_", "Aug ")}`).join("")}.`,
    ].join("\n"),
  }
}

export function answer(question: string, ctx: AssistantContext, meta: Meta): Reply {
  const q = question.toLowerCase()
  const crop: Crop = /soy/.test(q) ? "soybean" : /corn|maize/.test(q) ? "corn" : ctx.crop ?? "corn"
  const years = [...q.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]))
  const county = meta.counties[crop].find((r) => new RegExp(`\\b${r.name.toLowerCase()}\\b`).test(q))

  if (/^(hi|hello|hey|namaste)\b/.test(q)) return {
    thought: "Greeting.",
    text: `Hi! I can explain what the yield maps show: a single year, a county, how two seasons compare, or how accurate the model is.${ctx.crop && ctx.year ? ` You are looking at **${ctx.crop} ${ctx.year}** right now.` : ""}`,
  }
  if (years.some((y) => y > LAST_YEAR || y < FIRST_YEAR)) return {
    thought: "Checked which seasons the maps cover.",
    text: `The maps here cover **${FIRST_YEAR}–${LAST_YEAR}**: gap-filled Landsat (HISTARFM) to 2019, Harmonized Landsat Sentinel-2 (HLS) from ${HLS_FROM}. A season appears once its Cropland Data Layer and USDA yields are out.`,
  }
  if (county || (ctx.county && /\b(county|here|this one)\b/.test(q))) return countyReport(meta, crop, String(county?.GEOID ?? ctx.county), years[0] ?? ctx.year ?? LAST_YEAR)
  if (/best|worst|highest|lowest|weakest|strongest|why|drought|compare|rank|trend|good year|bad year/.test(q) && years.length !== 1) return extremes(meta, crop, /why|weak|worst|drought|low/.test(q))
  if (years.length) return yearReport(meta, crop, years[0])
  if (/accura|r2|r²|rmse|error|reliab|trust|validat/.test(q)) return accuracy(meta, crop)
  if (/how|method|model|work|ndvi|evi|predict|equation|coef|feature|satellite|weather/.test(q)) return method(meta, crop)
  if (/studio|code|python|earth engine|gee|export|script/.test(q)) return {
    thought: "Described what Studio offers.",
    text: [
      `**Studio** is the workspace for researchers:`,
      "",
      `- Python Earth Engine scripts in an editor, with a console, a pixel inspector and a task list`,
      `- **Models**: pick a crop and year and press Predict to put the 30 m map on the map, with a model-vs-USDA chart`,
      `- **Show in GEE** copies the code for the current map into the Earth Engine Code Editor`,
      ctx.page === "explore" ? `\nOpen it from **Studio** in the top bar; this map stays one click away.` : "",
    ].join("\n"),
  }
  if (ctx.crop && ctx.year) return yearReport(meta, ctx.crop, ctx.year)
  return {
    thought: "Looked for a crop, year or county in the question.",
    text: `I can help with the ${FIRST_YEAR}–${LAST_YEAR} corn and soybean yield maps of the Maumee watershed. Try a **year** ("How was 2015 for soybean?"), a **county** ("Allen County in 2019"), a comparison of seasons, or how accurate the model is.`,
  }
}
