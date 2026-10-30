# AgSensing · Yield Studio

Web platform for the AgSensing Lab's crop yield work at The Ohio State University: 30 m corn and soybean yield maps
estimated from satellite greenness and August weather (method of KC & Khanal, 2023), with a no-code Explore page and
a Python Earth Engine Studio.

| Folder | What it is |
|---|---|
| `frontend/` | React + Vite website (see its README). Deployed to GitHub Pages by `.github/workflows/deploy.yml`. |
| `backend/` | FastAPI, Supabase schema (OSU-only one-time-code sign-in) and the Cloud Storage → Globus → OSC file pipeline. |
| `PLAN.md` | Plan for the full application. |
| `prototypes/` | First single-file HTML mock-ups. |
| `data/` | Source data for the app (the large county boundary file is not in git). |

Until Supabase is configured the sign-in is a demo: any @osu.edu or @buckeyemail.osu.edu address, code `0000`.
The maps on the site are static demo files made from the 2009–2019 results; live Earth Engine comes in Phase 1 of the plan.
