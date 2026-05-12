# SENTINEL-SR

**Client-side Sentinel-2 Super-Resolution Viewer**  
Built for ISR/GEOINT audiences. Runs entirely in the browser — no backend, no API keys.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rmkenv/sentinel-sr)

---

## Overview

SENTINEL-SR upscales Sentinel-2 imagery (native 10m GSD) to estimated sub-meter resolution using a pure JavaScript SR pipeline:

| Stage | Method |
|---|---|
| Upsampling | Lanczos-3 resampling |
| Edge enhancement | Sobel gradient magnitude injection |
| Sharpening | 3×3 unsharp mask kernel |
| Band composites | Per-pixel channel remapping |

Estimated output GSD at common scale factors:

| Scale | Est. GSD |
|---|---|
| 2× | 5.00 m |
| 3× | 3.33 m |
| 4× | 2.50 m |
| 6× | 1.67 m |
| 8× | 1.25 m |

> **Note:** This is classical signal processing, not a trained neural SR model. For production ISR use, swap the JS pipeline for a call to a GPU-backed SRCNN / Real-ESRGAN endpoint.

---

## Features

- **3 demo scenes** — Urban complex, Coastal AOI, Airfield (procedurally generated)
- **Upload your own imagery** — any PNG/JPG from an S2 L2A download
- **5 band composites** — Natural Color, False Color IR, NDVI, SWIR, Thermal Proxy
- **3 SR algorithms** — Lanczos+Edge (recommended), Lanczos only, Bicubic+Sharpen
- **A/B split compare** — drag the split line to compare native vs. SR output
- **Pan + zoom** — mousewheel zoom up to 8×, click-drag to pan
- **Live metrics** — PSNR (estimated), SSIM (estimated), output resolution

---

## Quickstart

```bash
git clone https://github.com/rmkenv/sentinel-sr.git
cd sentinel-sr
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Deploy to Vercel

### Option A — One click
Click the **Deploy with Vercel** button above.

### Option B — CLI
```bash
npm i -g vercel
vercel --prod
```

Vercel auto-detects Vite. No environment variables required.

---

## Repo Structure

```
sentinel-sr/
├── index.html
├── vercel.json
├── vite.config.js
├── package.json
├── .gitignore
└── src/
    ├── main.jsx
    └── SentinelSRViewer.jsx   ← all logic + UI
```

---

## Roadmap

- [ ] Real-ESRGAN model endpoint integration (FastAPI / Modal)
- [ ] STAC API live tile fetch (Microsoft Planetary Computer)
- [ ] AOI draw + coordinate export (GeoJSON)
- [ ] GeoTIFF export of SR output
- [ ] Zoomable COG tile streaming

---

## Data

Demo scenes are procedurally generated to simulate Sentinel-2 L2A appearance.  
For real data, download from [Copernicus Browser](https://browser.dataspace.copernicus.eu/) or use [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/).

---

## License

MIT — IQSpatial / rmkenv  
Not for operational ISR use. Demonstration purposes only.
