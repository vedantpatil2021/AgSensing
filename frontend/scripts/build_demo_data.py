"""Static data for the frontend: turns the v2.0 outputs into public/cog/ (map layers as Cloud-Optimized GeoTIFFs at the
full 30 m resolution) and public/demo/meta.json, and cuts the US counties in
v2.0/app/data/boundaries/US_County_Boundaries.geojson into a web-sized public/data/us_counties.geojson.

Map layers are GeoTIFFs, not pictures: the browser reads only the blocks it needs (HTTP range requests), from the
full-resolution image when zoomed in and from the built-in overviews when zoomed out, so every 30 m pixel stays sharp.
Values are stored as 16-bit integers (yield 0.01 t/ha, NDVI 0.0001, temperature 0.01 °C, rain 0.1 mm); a click reads
the full-resolution pixel. Years 2009-2019 use HISTARFM greenness and the paper model; 2020-2025 use HLS and the
HLS-trained model (see docs/data_extension_log.md).

Until the FastAPI backend exists, the frontend reads these files instead of calling Earth Engine.
Run from the repository root with the v2.0 environment:

    v2.0/.venv/bin/python -B v2.0/app/frontend/scripts/build_demo_data.py
"""
import json
from pathlib import Path

import joblib
import matplotlib
import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.shutil import copy as copy_raster

APP = Path(__file__).resolve().parents[2]       # v2.0/app
ROOT = APP.parents[1]                            # repository root
GEE = ROOT / "data/gee_export/GEE_yield_modeling"
V2 = ROOT / "outputs/v2.0"
OUT = APP / "frontend/public/demo"
COG = APP / "frontend/public/cog"
COUNTY_SRC = APP / "data/boundaries/US_County_Boundaries.geojson"
COUNTY_OUT = APP / "frontend/public/data/us_counties.geojson"
FIPS = ["18001", "18003", "18033", "26059", "39003", "39011", "39039", "39051", "39063", "39069", "39125", "39137", "39161", "39171"]
YEARS = range(2009, 2026)
HLS_FROM = 2020                # first year mapped with HLS greenness and the HLS-trained model

RAMPS = {  # ColorBrewer ramps (RdYlGn, YlGn, RdYlBu reversed, Blues)
    "yield": ["#d73027", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"],
    "ndvi": ["#ffffcc", "#c2e699", "#78c679", "#238443"],
    "temp": ["#4575b4", "#91bfdb", "#ffffbf", "#fc8d59", "#d73027"],
    "ppt": ["#eff3ff", "#9ecae1", "#4292c6", "#08519c"],
}
PALETTES = {  # layer kind -> (ramp, min, max, unit)
    "yield_corn": ("yield", 6.0, 12.5, "t/ha"),
    "yield_soybean": ("yield", 2.2, 4.0, "t/ha"),
    "ndvi": ("ndvi", 0.55, 0.9, ""),
    "temp": ("temp", 20.0, 25.0, "°C"),
    "ppt": ("ppt", 20.0, 200.0, "mm"),
}
SCALE = {"yield_corn": 100, "yield_soybean": 100, "ndvi": 10000, "temp": 100, "ppt": 10}   # stored integer = value x scale
NODATA = -32768
COLORS = {k: (matplotlib.colors.LinearSegmentedColormap.from_list(k, v)(np.linspace(0, 1, 64))[:, :3] * 255).astype("uint8")
          for k, v in RAMPS.items()}


def save_cog(path, kind, name):
    """Band 1 of a GeoTIFF -> public/cog/<name>.tif (Cloud-Optimized GeoTIFF, same grid, int16 with nodata), and its
    full-resolution stats."""
    with rasterio.open(path) as s:
        full = s.read(1, masked=True).filled(np.nan).astype("float64")
        profile, b = s.profile, s.bounds
    ok = np.isfinite(full)
    v = full[ok]
    stats = {"mean": round(float(v.mean()), 3), "min": round(float(v.min()), 3), "max": round(float(v.max()), 3), "n": int(v.size)}
    q = np.full(full.shape, NODATA, "int16")
    q[ok] = np.clip(np.round(v * SCALE[kind]), NODATA + 1, 32767)
    tmp = COG / f"{name}.tmp.tif"
    with rasterio.open(tmp, "w", driver="GTiff", dtype="int16", count=1, width=profile["width"], height=profile["height"],
                       crs=profile["crs"], transform=profile["transform"], nodata=NODATA) as o:
        o.write(q, 1)
    copy_raster(tmp, COG / f"{name}.tif", driver="COG", BLOCKSIZE="512", COMPRESS="DEFLATE", PREDICTOR="2", LEVEL="9",
                OVERVIEW_RESAMPLING="AVERAGE")            # overviews are only for zoomed-out display
    tmp.unlink()
    return {"kind": kind, "url": f"/cog/{name}.tif", "bounds": [[b.bottom, b.left], [b.top, b.right]], "stats": stats,
            "scale": SCALE[kind], "nodata": NODATA, "source": None}


COG.mkdir(parents=True, exist_ok=True)
layers, missing = {}, []
for year in YEARS:
    source = "HLS" if year >= HLS_FROM else "HISTARFM"
    for crop in ["corn", "soybean"]:
        for kind, key, path in [(f"yield_{crop}", f"yield_{crop}_{year}", V2 / f"yield_maps/{year}_{crop}_yield.tif"),
                                ("ndvi", f"ndvi_{crop}_{year}", GEE / f"{crop}_veg_index_{year}.tif")]:
            if not path.exists():
                missing.append(str(path.relative_to(ROOT)))
                continue
            layers[key] = save_cog(path, kind, key) | {"source": source}
    for var in ["temp", "ppt"]:
        layers[f"{var}_{year}"] = save_cog(GEE / f"{year}_{var}_aug.tif", var, f"{var}_{year}") | {"source": "PRISM"}
    print(year, "done", flush=True)

palettes = {k: {"colors": ["#%02x%02x%02x" % tuple(c) for c in COLORS[r].tolist()], "min": lo, "max": hi, "unit": u}
            for k, (r, lo, hi, u) in PALETTES.items()}

names = pd.read_csv(GEE / "corn_veg_index_by_county.csv")[["GEOID", "NAME"]].drop_duplicates().set_index("GEOID")["NAME"]
counties, models, models_hls = {}, {}, {}
for crop in ["corn", "soybean"]:
    t = pd.read_csv(V2 / f"training/training_{crop}.csv")
    t["name"] = t.GEOID.map(names)
    for suffix, store, rows in [("", models, t.year < HLS_FROM), ("_hls", models_hls, t.year >= HLS_FROM)]:
        m = joblib.load(V2 / f"models/{crop}_final_model{suffix}.joblib")
        metrics = pd.read_csv(V2 / f"results/model_comparison{suffix}.csv")
        store[crop] = {"intercept": m.intercept_, "coef": dict(zip(m.feature_names_in_, m.coef_)),
                       "metrics": metrics[metrics.crop == crop].drop(columns="crop").round(3).to_dict("records")}
        t.loc[rows, "pred"] = m.predict(t.loc[rows, list(m.feature_names_in_)])     # each year with the model its map uses
    counties[crop] = t[["GEOID", "name", "year", "Value_ton_ha", "pred"]].round(3).rename(columns={"Value_ton_ha": "obs"}).to_dict("records")

# Forward test (train on years <= T, predict T+1..T+3; forecast_backtest.py), HLS series, paper MLR: the honest
# "next seasons" accuracy
bt = pd.read_csv(V2 / "results/forecast_backtest.csv")
bt = bt[(bt.source == "HLS") & (bt.model == "MLR, 4 predictors (paper)")]
forecast = {crop: bt[bt.crop == crop][["horizon", "n", "RMSE", "R2", "bias", "within_year_r"]].round(3).to_dict("records") for crop in ["corn", "soybean"]}

# Field-scanner figure: the 2019 corn map averaged into 6 x 5 blocks (null where a block has under 2% corn pixels)
COLS, ROWS = 6, 5
with rasterio.open(V2 / "yield_maps/2019_corn_yield.tif") as s:
    full = s.read(1, masked=True).filled(np.nan)
blocks = []
for r in range(ROWS):
    for c in range(COLS):
        b = full[r * full.shape[0] // ROWS:(r + 1) * full.shape[0] // ROWS, c * full.shape[1] // COLS:(c + 1) * full.shape[1] // COLS]
        ok = np.isfinite(b)
        blocks.append(round(float(b[ok].mean()), 2) if ok.mean() > 0.02 else None)
scan = {"crop": "corn", "year": 2019, "cols": COLS, "rows": ROWS, "values": blocks}

# Study counties: simplified outlines for the map, and each county's mean of every 30-m yield map
def simplify(points, tol=0.0003):
    """Douglas-Peucker on one ring (degrees; 0.0003 is about 30 m)."""
    pts = np.asarray(points)
    keep = np.zeros(len(pts), bool)
    keep[[0, -1]] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        seg = pts[b] - pts[a]
        v = pts[a + 1:b] - pts[a]
        length = np.hypot(*seg)
        d = np.abs(seg[0] * v[:, 1] - seg[1] * v[:, 0]) / length if length else np.hypot(v[:, 0], v[:, 1])   # closed ring: distance to the point
        i = int(d.argmax())
        if d[i] > tol:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return np.round(pts[keep], 5).tolist()


def outline(g, tol):
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    polys = [[r for r in (simplify(ring, tol) for ring in poly) if len(r) >= 4] for poly in polys]
    polys = [p for p in polys if p]
    return {"type": "MultiPolygon", "coordinates": polys} if len(polys) > 1 else {"type": "Polygon", "coordinates": polys[0]}


source = json.loads(COUNTY_SRC.read_text())
features, study = [], []
for f in source["features"]:
    p = f["properties"]
    inside = p["GEOID"] in FIPS
    props = {"GEOID": p["GEOID"], "NAME": p["NAME"], "STATE": p["STATE_NAME"], "area_km2": round(p["ALAND"] / 1e6), "study": inside}
    features.append({"type": "Feature", "properties": props, "geometry": outline(f["geometry"], 0.0003 if inside else 0.004)})
    if inside:
        study.append({"properties": props, "geometry": f["geometry"]})     # full detail for the zonal means
COUNTY_OUT.parent.mkdir(parents=True, exist_ok=True)
COUNTY_OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")).replace(".0,", ","))
(COUNTY_OUT.parent / "maumee_counties.geojson").unlink(missing_ok=True)

with rasterio.open(V2 / "yield_maps/2019_corn_yield.tif") as s:
    zones = rasterize([(f["geometry"], i + 1) for i, f in enumerate(study)], out_shape=s.shape, transform=s.transform, dtype="uint8")
county_maps = {}
for crop in ["corn", "soybean"]:
    county_maps[crop] = {}
    for year in YEARS:
        with rasterio.open(V2 / f"yield_maps/{year}_{crop}_yield.tif") as s:
            a = s.read(1, masked=True).filled(np.nan)
        ok = np.isfinite(a) & (zones > 0)
        sums = np.bincount(zones[ok], a[ok], minlength=len(study) + 1)
        counts = np.bincount(zones[ok], minlength=len(study) + 1)
        county_maps[crop][year] = {f["properties"]["GEOID"]: [round(float(sums[i + 1] / counts[i + 1]), 2), int(counts[i + 1])]
                                   for i, f in enumerate(study) if counts[i + 1]}
print(f"{len(features)} counties ({len(study)} in the study area) -> {COUNTY_OUT} ({COUNTY_OUT.stat().st_size // 1024} KB)")

(OUT / "meta.json").write_text(json.dumps({"years": list(YEARS), "hlsFrom": HLS_FROM, "layers": layers, "palettes": palettes,
                                           "counties": counties, "models": models, "modelsHls": models_hls, "forecast": forecast,
                                           "scan": scan, "countyMaps": county_maps}, separators=(",", ":")))
print("scan blocks:", blocks)
print(f"{len(layers)} layers -> {COG} ({sum(f.stat().st_size for f in COG.glob('*.tif')) // 2**20} MB)")
print("no file, layer skipped:", missing or "none")
