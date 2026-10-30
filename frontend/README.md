# Yield Studio frontend

React + Vite + Tailwind, with Cult UI components (`src/components/ui`) and an Anatomy figure (`src/figures/orbit-survey`).

| Route | Page |
|---|---|
| `/login` | Default page. Sign in with a one-time code emailed to an @osu.edu or @buckeyemail.osu.edu address (Supabase). The other routes need it. Until Supabase is set up it is a demo: no email is sent and the code is `0000`. |
| `/explore` | Explore: pick a crop and a year, read the 30 m yield map. No code. |
| `/studio` | Studio: Python Earth Engine scripts, models, console, tasks, Code Editor snippets. |

```bash
cp .env.example .env.local   # Supabase URL and anon key; without them sign-in is the 0000 demo
npm install
npm run dev        # http://localhost:5173
npm run build
```

Login and the backend are in `src/lib/auth.tsx` and `../backend/` (see its README for the Supabase setup). The maps still come from static files: `src/lib/api.ts` reads static files in `public/demo/` and `public/data/` that
`scripts/build_demo_data.py` writes from the v2.0 outputs and `../data/boundaries/` (run it from the repository root):

```bash
v2.0/.venv/bin/python -B v2.0/app/frontend/scripts/build_demo_data.py
```

The FastAPI backend will replace those files with the same shapes (map tiles from Earth Engine `getMapId`),
and the Studio's demo runner (`run` in `src/pages/studio.tsx`) with real execution.
