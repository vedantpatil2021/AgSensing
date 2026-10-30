# Yield Studio: plan for the full application

Yield Studio is the web platform for the lab's crop yield work. It starts from the method of KC & Khanal (2023)
(county NASS yields train a model on satellite greenness and August weather, which then maps yield at 30 m)
and grows it into a tool that runs on Google Earth Engine (GEE), stays current every season, and gives
researchers the full power of GEE.

## Goals

- **Anyone can read the maps.** Pick a crop and a season and see 30 m yield, county and field details. No account, no code.
- **Live, not frozen.** New seasons appear on their own; during the season a forecast updates every week.
- **Full Earth Engine.** Researchers can search the whole GEE catalog, import any dataset and run any GEE code.
- **Field scale.** Users can upload field boundaries and ground-truth yields to check and improve the models.
- **Little to install.** Heavy work runs on GEE and the Ohio Supercomputer Center (OSC), not on a laptop.

## Where we are

| Part | State |
|---|---|
| Pipeline (`v2.0/1_gee` … `4_cover_crop_analysis`) | Done in Python; reproduces the paper's results. |
| Website (`app/frontend`) | Explore and Studio pages, maps, counties, search. Reads static files made from the v2.0 outputs. |
| Logins | OSU-only one-time-code sign-in (Supabase) on the website and FastAPI; database schema for profiles, files and jobs (`app/backend`). Needs a Supabase project to go live. |
| File pipeline | Cloud Storage → Globus → OSC functions written (`app/backend/pipeline`), not deployed. |
| Live GEE | Not started. |

## Modules

| Module | For | What it gives |
|---|---|---|
| **Explore** | Farmers, students, extension staff | Crop and season → 30 m yield map, county and field details. |
| **Forecast** | Everyone | In-season yield forecast for the current year, updated weekly. |
| **Studio** | Researchers | Write and run Python GEE code, with map, console, inspector and tasks. |
| **Data Catalog** | Everyone | Search every GEE dataset; add it to the map or import it into Studio. |
| **My Fields** | Researchers, farmers | Upload field boundaries and yields; compare with the maps. |
| **Models** | Lab team | Train, compare, version and publish models. |
| **Jobs** | Everyone | Progress of long work: exports, full-season maps, training. |

## Architecture

```
React website (Vite, Leaflet)
   ├── Supabase ──────────── logins, saved runs, fields (PostGIS); no files
   └── FastAPI backend (Python)
          ├── Google Earth Engine ── data, processing, map tiles, exports
          ├── Job queue ──────────── long tasks in the background
          └── OSC ────────────────── model training, large batch jobs, all files (long term)

Files: GEE export / user upload → Cloud Storage (staging) → Globus → OSC → deleted from Cloud Storage
```

- **Frontend:** React + Vite + Tailwind + Cult UI + Leaflet (the current `app/frontend`).
- **Backend:** FastAPI in Python, because GEE (`earthengine-api`), scikit-learn and the v2.0 pipeline are all Python.
- **Earth Engine** does the heavy processing on Google's servers. We send small results to the browser
  (map tiles from `getMapId`, numbers, tables), never raw imagery.
- **Supabase:** PostgreSQL with **PostGIS** for county and field shapes, plus logins. It stores records, not files.
  It is open source and can be self-hosted at OSU or OSC.
- **Files** never stay with the user or in Supabase: they land in Google Cloud Storage and move to OSC (next section).
- **Job queue:** anything longer than a minute or two (exports, training) runs in the background with progress.
- **OSC:** training and large batch work.

## Logins and Earth Engine access

- **Everything runs under the lab's service account and the lab's storage.** Users never connect their own
  Google, GEE or cloud storage account.
- **Explore and Forecast** need no login. **Studio, My Fields and Models** use a plain app login (Supabase)
  only to know who ran what and to keep their jobs and fields apart.
- All GEE work uses the lab's quota, assets and dataset access. The backend limits each user's jobs so one person
  cannot use up the lab's quota.
- Who can use what is the **For** column of the Modules table; there are no separate roles.
- **Later, if needed:** "Sign in with Google" so a researcher can run Studio on their own GEE account and see their
  own assets. Not in the first version.

## File pipeline: Cloud Storage → Globus → OSC

Users never save files on their own machine or in Supabase. Every file (GEE exports, finished maps, user uploads,
training outputs) goes through one automatic pipeline, so the Cloud Storage bucket stays inside the free tier.

```
GEE Export.*.toCloudStorage / upload (signed URL)
   → gs://<bucket>/staging/…                  file lands
   → event: object finalized (Eventarc)        fires as soon as the file is complete
   → Cloud Run function                        starts a Globus transfer, checksum on
   → OSC project storage                       file arrives at OSC
   → transfer SUCCEEDED (Globus status)        checked by the same function on a schedule
   → delete from Cloud Storage                 only after success; the job record points to the OSC path
```

- **Trigger:** the bucket's "object finalized" event starts a small Cloud Run function. No polling, no manual step.
- **Move:** the function submits a **Globus Transfer** from the lab's Cloud Storage collection to the OSC collection,
  with checksum verification, using a Globus app (service) credential kept in Secret Manager.
- **Delete:** a scheduled check reads the transfer status. On **SUCCEEDED** it deletes the file from the bucket and
  writes the OSC path into the job record in Supabase. On failure it retries, then alerts; the file is never deleted
  before it is safely at OSC.
- **Reading later:** the backend reads files from OSC; maps that must load fast are also kept as GEE assets.
- **Free tier:** Cloud Storage gives 5 GB of Standard storage free in `us-central1`, `us-east1` or `us-west1`, and
  Cloud Run functions give 2 million calls a month free. Files stay in the bucket only for minutes to hours, so
  use stays far below that. Large GEE exports are split into tiles (`fileDimensions`) so no single batch fills the bucket.
- **Note:** Globus' Google Cloud Storage connector needs a Globus subscription. We check with OSC/OSU IT that their
  subscription covers it and that the lab can use it.

## Data

Years are never hard-coded. A **data source registry** (a table in the database) says which dataset serves which years,
and the backend reports the years that are available.

| What | Source | Updates |
|---|---|---|
| Satellite, past | HISTARFM (gap-filled Landsat) | 2009 – Oct 2021 |
| Satellite, current and live | HLS (Landsat + Sentinel-2, 30 m) | Every 2–3 days |
| Weather | PRISM, Daymet | Daily |
| Crop mask | USDA CDL | Yearly |
| Official yields | USDA NASS Quick Stats API | Yearly |
| Counties | TIGER (also in GEE); `app/data/boundaries` | Rarely |
| Fields | User uploads (through the file pipeline) | When users upload |

**Scheduled work**

- **Weekly, during the season:** pull new HLS imagery and update the forecast.
- **Yearly:** when the new CDL and NASS yields are out, build that season's final maps, retrain, and save the maps
  as **GEE assets** so they load instantly. The new season then appears in the app with no code change.
- **In season**, when that year's CDL does not exist yet: use the previous CDL or the crop-rotation pattern,
  and label the map as a forecast with its data date ("data to 15 July").

## Using all of Earth Engine

- **Studio runs real code.** The backend runs the user's `earthengine-api` code in a sandbox, under the lab's
  service account, and turns
  `Map.addLayer` into map tiles, `print` into console output and `Export` into tasks, as the Code Editor does.
- **Catalog search.** GEE publishes its whole catalog as a STAC listing; the backend indexes it so the search box
  finds every dataset (name, ID, dates, bands, resolution, default colours), including new ones.
  "Add to map" previews it; "Import" adds `ee.ImageCollection("ID")` to the Studio script. The lab's own assets
  appear in the same search.
- **Open in Code Editor.** Any map can be handed to the real Code Editor as a snippet.
- Limits are GEE's own: interactive requests time out after a few minutes, so large areas and many years go through exports.

| GEE capability | Call | Used for |
|---|---|---|
| Data catalog | `ee.ImageCollection("…")` | Any dataset, any years |
| Server-side processing | `filterDate`, `map`, `reduce`, `updateMask`, `expression` | Indices, composites, masks, the yield model |
| Map tiles | `getMapId` | Live 30 m maps in Leaflet |
| Point values | `reduceRegion`, `sample` | Click inspector |
| Zonal statistics | `reduceRegions` | County and field averages |
| Time series | reducers over a collection | Season charts |
| Machine learning | `ee.Reducer.linearRegression`, `ee.Classifier.smileRandomForest` (regression) | Models inside GEE |
| Data into Python | `ee.data.computeFeatures`, `computePixels` | Tables and arrays for scikit-learn on OSC |
| Exports | `ee.batch.Export.*` | Large maps, many years |
| Assets | `ee.Image("projects/…")` | Saved final maps |

## Models

- Every model has a **version**: data, features, accuracy and training date.
- Training runs on OSC. A lab admin **publishes** the version the maps use.
- Simple models (linear regression, random forest) run **inside GEE**, so maps are fast.
- Heavier models run on OSC and write their maps to OSC storage, and to GEE assets when the app shows them.
- With field data, the county-trained model is **calibrated at field scale**.

## Speed and cost

- Save finished maps as GEE assets instead of recomputing them.
- Cache map tiles and county statistics.
- Long work always goes through the job queue.
- GEE is free for noncommercial research; Supabase's free plan is enough to start, since it holds no files;
  Cloud Storage and Cloud Run stay in their free tier because the pipeline empties the bucket; hosting can be on OSC or an OSU server.

## Phases

| Phase | Build | Done when |
|---|---|---|
| **1** | FastAPI + GEE: `/tiles`, `/value`, `/county-stats`, `/available-years`; frontend switched from static files to the API | Explore runs on live GEE for 2009–2019 and matches the v2.0 maps |
| **2** | Data source registry, HLS, NASS API | A season after 2019 appears with no code change |
| **3** | Supabase logins, real Studio runner, catalog search | A researcher imports any dataset and runs their own GEE code, with no account of their own |
| **4** | Job queue, file pipeline (Cloud Storage → Globus → OSC), OSC training, model versions | A full-season export lands at OSC by itself, the bucket is empty afterwards, and a retrain runs end to end |
| **5** | Forecast module, weekly | The current season shows a dated forecast |
| **6** | My Fields: uploads and field-scale models | Field yields are compared with and used to calibrate the maps |

## Needed from the lab before Phase 1

1. A Google Cloud project registered for noncommercial Earth Engine.
2. A service account for it, with HISTARFM access (or start with HLS, which needs no extra access).
3. An OSC account and project.
4. A hosting decision: OSC, an OSU server or a cloud provider.
5. A Supabase project (free) for Phase 3.
6. For Phase 4: a Cloud Storage bucket in a free-tier region, a Globus collection for it under OSU's subscription,
   and the OSC Globus collection path where files should land.

## Folder layout

```
v2.0/
  1_gee … 4_cover_crop_analysis   the pipeline
  app/
    PLAN.md          this plan
    frontend/        React website
    backend/         FastAPI, Supabase schema, and the Cloud Run transfer functions in backend/pipeline/
    data/            source data for the app (county boundaries)
    prototypes/      first single-file HTML mock-ups
```
