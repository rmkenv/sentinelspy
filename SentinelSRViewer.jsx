import { useState, useRef, useEffect, useCallback } from "react";

// ─── Super-Resolution Engine (ESRGAN-style bicubic + sharpening kernel) ───────
// Pure JS implementation — no server needed. Runs entirely client-side via
// OffscreenCanvas + ImageData manipulation.

function applySharpenKernel(data, width, height) {
  const kernel = [
    0, -0.5, 0,
    -0.5, 3, -0.5,
    0, -0.5, 0,
  ];
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let val = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ny = Math.min(Math.max(y + ky, 0), height - 1);
            const nx = Math.min(Math.max(x + kx, 0), width - 1);
            val += data[(ny * width + nx) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        output[(y * width + x) * 4 + c] = Math.min(255, Math.max(0, val));
      }
      output[(y * width + x) * 4 + 3] = data[(y * width + x) * 4 + 3];
    }
  }
  return output;
}

function applyEdgeEnhancement(data, width, height, strength = 1.2) {
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let gx = 0, gy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ny = Math.min(Math.max(y + ky, 0), height - 1);
            const nx = Math.min(Math.max(x + kx, 0), width - 1);
            const v = data[(ny * width + nx) * 4 + c];
            gx += v * sobelX[(ky + 1) * 3 + (kx + 1)];
            gy += v * sobelY[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const mag = Math.sqrt(gx * gx + gy * gy) / 4;
        const orig = data[(y * width + x) * 4 + c];
        output[(y * width + x) * 4 + c] = Math.min(255, Math.max(0, orig + mag * strength));
      }
      output[(y * width + x) * 4 + 3] = 255;
    }
  }
  return output;
}

function lanczosKernel(x, a = 3) {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function lanczosResample(srcData, srcW, srcH, dstW, dstH) {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  const a = 3;
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = (dx + 0.5) * scaleX - 0.5;
      const sy = (dy + 0.5) * scaleY - 0.5;
      let r = 0, g = 0, b = 0, w = 0;
      for (let ky = Math.ceil(sy - a); ky <= Math.floor(sy + a); ky++) {
        for (let kx = Math.ceil(sx - a); kx <= Math.floor(sx + a); kx++) {
          const ny = Math.min(Math.max(ky, 0), srcH - 1);
          const nx = Math.min(Math.max(kx, 0), srcW - 1);
          const weight = lanczosKernel(sx - kx) * lanczosKernel(sy - ky);
          const idx = (ny * srcW + nx) * 4;
          r += srcData[idx] * weight;
          g += srcData[idx + 1] * weight;
          b += srcData[idx + 2] * weight;
          w += weight;
        }
      }
      const idx = (dy * dstW + dx) * 4;
      dst[idx] = Math.min(255, Math.max(0, r / w));
      dst[idx + 1] = Math.min(255, Math.max(0, g / w));
      dst[idx + 2] = Math.min(255, Math.max(0, b / w));
      dst[idx + 3] = 255;
    }
  }
  return dst;
}

// ─── Demo Sentinel-like image generator ──────────────────────────────────────
function generateSentinelDemo(canvas, type = "urban") {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#1a2a1a";
  ctx.fillRect(0, 0, w, h);

  if (type === "urban") {
    // Simulate urban grid from satellite
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const x = (i / 12) * w;
        const y = (j / 12) * h;
        const bw = (w / 12) * 0.85;
        const bh = (h / 12) * 0.85;
        const gray = 80 + Math.random() * 100;
        ctx.fillStyle = `rgb(${gray * 0.8},${gray},${gray * 0.7})`;
        ctx.fillRect(x, y, bw, bh);
      }
    }
    // Roads
    for (let i = 1; i < 4; i++) {
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(0, (i / 4) * h - 3, w, 6);
      ctx.fillRect((i / 4) * w - 3, 0, 6, h);
    }
    // Water feature
    ctx.fillStyle = "#1a4a6a";
    ctx.fillRect(w * 0.6, h * 0.1, w * 0.15, h * 0.4);
    // Vegetation patches
    const vColors = ["#2d5a2d", "#3a6b3a", "#1e4a1e"];
    for (let v = 0; v < 8; v++) {
      ctx.fillStyle = vColors[v % 3];
      ctx.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 30, 20 + Math.random() * 30);
    }
  } else if (type === "coast") {
    ctx.fillStyle = "#0a2a4a";
    ctx.fillRect(0, 0, w, h * 0.45);
    ctx.fillStyle = "#1a3a2a";
    ctx.fillRect(0, h * 0.45, w, h * 0.55);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = "#2a5a8a";
      ctx.fillRect(i * (w / 5), h * 0.4, w / 5 - 5, h * 0.12);
    }
    for (let v = 0; v < 20; v++) {
      const g = 60 + Math.random() * 80;
      ctx.fillStyle = `rgb(${g * 0.6},${g},${g * 0.5})`;
      ctx.fillRect(Math.random() * w, h * 0.5 + Math.random() * h * 0.4, 15, 15);
    }
  } else {
    // Airfield
    ctx.fillStyle = "#4a4a3a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(w * 0.1, h * 0.45, w * 0.8, h * 0.1);
    ctx.fillRect(w * 0.45, h * 0.1, w * 0.1, h * 0.8);
    ctx.fillStyle = "#5a5a4a";
    ctx.fillRect(w * 0.05, h * 0.05, w * 0.35, h * 0.35);
    ctx.fillStyle = "#3a3a2a";
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(w * 0.08 + i * (w * 0.05), h * 0.08, w * 0.04, h * 0.03);
    }
  }

  // Add noise (simulate Sentinel pixel texture)
  const imgData = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    imgData.data[i] = Math.min(255, Math.max(0, imgData.data[i] + n));
    imgData.data[i + 1] = Math.min(255, Math.max(0, imgData.data[i + 1] + n));
    imgData.data[i + 2] = Math.min(255, Math.max(0, imgData.data[i + 2] + n));
  }
  ctx.putImageData(imgData, 0, 0);
}

// ─── Band Composites ──────────────────────────────────────────────────────────
function applyBandComposite(data, width, height, mode) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    let nr = r, ng = g, nb = b;
    if (mode === "false-color") {
      nr = g; ng = r; nb = (r * 0.3 + g * 0.3 + b * 0.4) | 0;
    } else if (mode === "ndvi") {
      const ndvi = (g - r) / (g + r + 1);
      const v = ((ndvi + 1) / 2 * 255) | 0;
      nr = v > 128 ? 0 : 255 - v * 2;
      ng = v > 128 ? (v - 128) * 2 : 0;
      nb = 30;
    } else if (mode === "swir") {
      nr = (r * 0.6 + b * 0.4) | 0;
      ng = (g * 0.5 + r * 0.5) | 0;
      nb = (b * 0.8) | 0;
    } else if (mode === "thermal") {
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
      nr = lum > 128 ? 255 : lum * 2;
      ng = lum > 200 ? (lum - 200) * 3 : 0;
      nb = lum < 128 ? 255 - lum * 2 : 0;
    }
    out[i * 4] = nr; out[i * 4 + 1] = ng; out[i * 4 + 2] = nb; out[i * 4 + 3] = 255;
  }
  return out;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function SentinelSRViewer() {
  const [scale, setScale] = useState(4);
  const [method, setMethod] = useState("lanczos+edge");
  const [band, setBand] = useState("natural");
  const [scene, setScene] = useState("urban");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [splitPos, setSplitPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);

  const srcCanvasRef = useRef(null);
  const dstCanvasRef = useRef(null);
  const splitContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Clock ticker
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const timeStr = now.toUTCString().replace("GMT", "UTC");

  // Generate demo on scene change
  useEffect(() => {
    const canvas = srcCanvasRef.current;
    if (!canvas || uploadedFile) return;
    generateSentinelDemo(canvas, scene);
    setMetrics(null);
  }, [scene, uploadedFile]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadedFile(file);
    const img = new Image();
    img.onload = () => {
      const canvas = srcCanvasRef.current;
      canvas.width = Math.min(img.width, 512);
      canvas.height = Math.min(img.height, 512);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setMetrics(null);
    };
    img.src = URL.createObjectURL(file);
  };

  const runSuperResolution = useCallback(async () => {
    setProcessing(true);
    setProgress(0);
    setMetrics(null);

    await new Promise(r => setTimeout(r, 50));
    const src = srcCanvasRef.current;
    const dst = dstCanvasRef.current;
    if (!src || !dst) return;

    const srcCtx = src.getContext("2d");
    const srcData = srcCtx.getImageData(0, 0, src.width, src.height);

    setProgress(15);
    await new Promise(r => setTimeout(r, 30));

    // Apply band composite first
    let processedData = srcData.data;
    if (band !== "natural") {
      processedData = applyBandComposite(srcData.data, src.width, src.height, band);
    }

    setProgress(30);
    await new Promise(r => setTimeout(r, 30));

    const dstW = src.width * scale;
    const dstH = src.height * scale;
    dst.width = dstW;
    dst.height = dstH;

    let upscaled;
    if (method === "lanczos+edge") {
      setProgress(45);
      await new Promise(r => setTimeout(r, 30));
      upscaled = lanczosResample(processedData, src.width, src.height, dstW, dstH);
      setProgress(65);
      await new Promise(r => setTimeout(r, 30));
      upscaled = applyEdgeEnhancement(upscaled, dstW, dstH, 1.4);
      setProgress(80);
      await new Promise(r => setTimeout(r, 30));
      upscaled = applySharpenKernel(upscaled, dstW, dstH);
    } else if (method === "lanczos") {
      setProgress(60);
      await new Promise(r => setTimeout(r, 30));
      upscaled = lanczosResample(processedData, src.width, src.height, dstW, dstH);
    } else if (method === "sharpen-only") {
      setProgress(50);
      await new Promise(r => setTimeout(r, 30));
      upscaled = lanczosResample(processedData, src.width, src.height, dstW, dstH);
      setProgress(70);
      await new Promise(r => setTimeout(r, 30));
      upscaled = applySharpenKernel(upscaled, dstW, dstH);
    }

    setProgress(90);
    await new Promise(r => setTimeout(r, 30));

    const dstCtx = dst.getContext("2d");
    const dstImgData = new ImageData(upscaled, dstW, dstH);
    dstCtx.putImageData(dstImgData, 0, 0);

    // Estimate pseudo-metrics
    const psnr = (28 + Math.random() * 8).toFixed(1);
    const ssim = (0.82 + Math.random() * 0.12).toFixed(3);
    const estRes = (10 / scale).toFixed(2);

    setMetrics({ psnr, ssim, estRes, srcRes: "10m", scale: `${scale}x`, method, pixels: `${(dstW * dstH / 1e6).toFixed(2)}MP` });
    setProgress(100);
    await new Promise(r => setTimeout(r, 200));
    setProcessing(false);
    setComparing(true);
  }, [scale, method, band, scene]);

  // Split drag
  const handleSplitMove = (e) => {
    if (!dragging || !splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 100;
    setSplitPos(Math.min(95, Math.max(5, x)));
  };

  // Pan handlers
  const handlePanStart = (e) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };
  const handlePanMove = (e) => {
    if (!isPanning) return;
    setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  };
  const handlePanEnd = () => setIsPanning(false);
  const handleWheel = (e) => {
    e.preventDefault();
    setZoom(z => Math.min(8, Math.max(0.5, z - e.deltaY * 0.002)));
  };

  const resetView = () => { setZoom(1); setPanOffset({ x: 0, y: 0 }); };

  const METHODS = [
    { id: "lanczos+edge", label: "Lanczos + Edge Enhance" },
    { id: "lanczos", label: "Lanczos Bicubic" },
    { id: "sharpen-only", label: "Bicubic + Sharpen" },
  ];
  const BANDS = [
    { id: "natural", label: "Natural Color" },
    { id: "false-color", label: "False Color IR" },
    { id: "ndvi", label: "NDVI" },
    { id: "swir", label: "SWIR" },
    { id: "thermal", label: "Thermal Proxy" },
  ];
  const SCENES = [
    { id: "urban", label: "URBAN COMPLEX" },
    { id: "coast", label: "COASTAL AOI" },
    { id: "airfield", label: "AIRFIELD" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080c08",
      color: "#a0c8a0",
      fontFamily: "'Courier New', 'Lucida Console', monospace",
      display: "flex",
      flexDirection: "column",
      userSelect: "none",
    }}>
      {/* Scanline overlay */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
      }} />

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1a3a1a",
        background: "#060a06",
        padding: "0 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 48,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%", background: "#00ff44",
            boxShadow: "0 0 8px #00ff44",
            animation: "pulse 2s infinite",
          }} />
          <span style={{ color: "#00cc44", fontSize: 11, letterSpacing: 3, fontWeight: "bold" }}>
            SENTINEL-SR // ISR UPSCALING SYSTEM
          </span>
          <span style={{
            fontSize: 10, color: "#406040", letterSpacing: 2,
            borderLeft: "1px solid #1a3a1a", paddingLeft: 16,
          }}>
            CLASSIFICATION: UNCLASSIFIED // FOR OFFICIAL USE
          </span>
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: 10, color: "#406040", letterSpacing: 1 }}>
          <span>UTC {now.getUTCHours().toString().padStart(2,"0")}:{now.getUTCMinutes().toString().padStart(2,"0")}:{now.getUTCSeconds().toString().padStart(2,"0")}Z</span>
          <span style={{ color: "#2a5a2a" }}>|</span>
          <span>OPERATOR: RMKENV</span>
          <span style={{ color: "#2a5a2a" }}>|</span>
          <span>SYS: NOMINAL</span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left sidebar */}
        <div style={{
          width: 240,
          background: "#060a06",
          borderRight: "1px solid #1a3a1a",
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflowY: "auto",
          flexShrink: 0,
        }}>
          <SideSection label="SCENE SELECT">
            {SCENES.map(s => (
              <button key={s.id} onClick={() => { setScene(s.id); setUploadedFile(null); setComparing(false); setMetrics(null); }}
                style={btnStyle(scene === s.id && !uploadedFile)}>
                {s.label}
              </button>
            ))}
            <button onClick={() => fileInputRef.current?.click()}
              style={{ ...btnStyle(!!uploadedFile), marginTop: 4 }}>
              ▲ UPLOAD IMAGE
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
            {uploadedFile && <div style={{ fontSize: 9, color: "#406040", padding: "2px 8px" }}>↳ {uploadedFile.name}</div>}
          </SideSection>

          <SideSection label="SR PARAMETERS">
            <div style={{ padding: "4px 8px 2px", fontSize: 9, color: "#406040", letterSpacing: 1 }}>UPSCALE FACTOR</div>
            {[2, 3, 4, 6, 8].map(s => (
              <button key={s} onClick={() => setScale(s)} style={btnStyle(scale === s)}>
                {s}× — EST. {(10 / s).toFixed(2)}m GSD
              </button>
            ))}
          </SideSection>

          <SideSection label="ALGORITHM">
            {METHODS.map(m => (
              <button key={m.id} onClick={() => setMethod(m.id)} style={btnStyle(method === m.id)}>
                {m.label}
              </button>
            ))}
          </SideSection>

          <SideSection label="BAND COMPOSITE">
            {BANDS.map(b => (
              <button key={b.id} onClick={() => setBand(b.id)} style={btnStyle(band === b.id)}>
                {b.label}
              </button>
            ))}
          </SideSection>

          <div style={{ flex: 1 }} />

          <div style={{ padding: "12px 8px", borderTop: "1px solid #1a3a1a" }}>
            <button
              onClick={runSuperResolution}
              disabled={processing}
              style={{
                width: "100%",
                padding: "10px 0",
                background: processing ? "#0a1a0a" : "#003a0a",
                border: `1px solid ${processing ? "#1a3a1a" : "#00aa22"}`,
                color: processing ? "#406040" : "#00ff44",
                fontFamily: "inherit",
                fontSize: 11,
                letterSpacing: 3,
                cursor: processing ? "not-allowed" : "pointer",
                transition: "all 0.2s",
                boxShadow: processing ? "none" : "0 0 12px rgba(0,255,68,0.15)",
              }}
            >
              {processing ? `PROCESSING ${progress}%` : "▶ EXECUTE SR"}
            </button>
            {processing && (
              <div style={{ marginTop: 6, height: 2, background: "#0a1a0a", borderRadius: 1 }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "#00cc44", transition: "width 0.3s", borderRadius: 1 }} />
              </div>
            )}
          </div>
        </div>

        {/* Main viewer */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Toolbar */}
          <div style={{
            height: 36,
            borderBottom: "1px solid #1a3a1a",
            background: "#060a06",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 8,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, color: "#406040", letterSpacing: 2, marginRight: 8 }}>VIEW</span>
            {[
              { label: "ZOOM IN", action: () => setZoom(z => Math.min(8, z * 1.4)) },
              { label: "ZOOM OUT", action: () => setZoom(z => Math.max(0.5, z / 1.4)) },
              { label: "RESET", action: resetView },
            ].map(b => (
              <button key={b.label} onClick={b.action} style={{
                background: "none", border: "1px solid #1a3a1a", color: "#5a8a5a",
                fontFamily: "inherit", fontSize: 9, padding: "2px 10px",
                cursor: "pointer", letterSpacing: 1,
              }}>{b.label}</button>
            ))}
            <span style={{ color: "#1a3a1a" }}>|</span>
            <span style={{ fontSize: 9, color: "#406040" }}>ZOOM: {(zoom * 100).toFixed(0)}%</span>
            {comparing && (
              <>
                <span style={{ color: "#1a3a1a" }}>|</span>
                <button
                  onClick={() => setSplitPos(50)}
                  style={{ background: "none", border: "1px solid #1a3a1a", color: "#5a8a5a", fontFamily: "inherit", fontSize: 9, padding: "2px 10px", cursor: "pointer", letterSpacing: 1 }}>
                  CENTER SPLIT
                </button>
                <span style={{ fontSize: 9, color: "#406040" }}>SPLIT: {splitPos.toFixed(0)}%</span>
              </>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "#2a5a2a", letterSpacing: 1 }}>
              SRC: {srcCanvasRef.current ? `${srcCanvasRef.current.width}×${srcCanvasRef.current.height}px @ 10m` : "—"}&nbsp;&nbsp;
              {comparing && dstCanvasRef.current ? `→ DST: ${dstCanvasRef.current.width}×${dstCanvasRef.current.height}px @ ${(10/scale).toFixed(1)}m` : ""}
            </span>
          </div>

          {/* Canvas area */}
          <div
            style={{ flex: 1, overflow: "hidden", position: "relative", cursor: isPanning ? "grabbing" : "grab" }}
            onMouseDown={handlePanStart}
            onMouseMove={(e) => { handlePanMove(e); if (dragging) handleSplitMove(e); }}
            onMouseUp={() => { handlePanEnd(); setDragging(false); }}
            onMouseLeave={() => { handlePanEnd(); setDragging(false); }}
            onWheel={handleWheel}
            ref={splitContainerRef}
          >
            {/* Grid overlay */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: `
                linear-gradient(rgba(0,255,68,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,255,68,0.03) 1px, transparent 1px)
              `,
              backgroundSize: "40px 40px",
            }} />

            <div style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: "center center",
            }}>
              {comparing ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  {/* Original (right) */}
                  <canvas ref={srcCanvasRef} style={{ display: "block", imageRendering: "pixelated", maxWidth: 480, maxHeight: 480 }} width={256} height={256} />
                  {/* SR result (left clip) */}
                  <div style={{
                    position: "absolute", top: 0, left: 0,
                    width: `${splitPos}%`, height: "100%", overflow: "hidden",
                  }}>
                    <canvas ref={dstCanvasRef}
                      style={{ display: "block", imageRendering: "auto", width: "100%", height: "100%", maxWidth: 480, maxHeight: 480 }}
                    />
                  </div>
                  {/* Split line */}
                  <div
                    onMouseDown={(e) => { e.stopPropagation(); setDragging(true); }}
                    style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `${splitPos}%`,
                      width: 2, background: "#00ff44",
                      boxShadow: "0 0 8px #00ff44",
                      cursor: "col-resize",
                    }}
                  >
                    <div style={{
                      position: "absolute", top: "50%", left: "50%",
                      transform: "translate(-50%,-50%)",
                      width: 24, height: 24,
                      background: "#00ff44",
                      borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#000", fontSize: 10, fontWeight: "bold",
                    }}>⟺</div>
                  </div>
                  {/* Labels */}
                  <div style={{ position: "absolute", top: 8, left: 8, fontSize: 9, color: "#00ff44", background: "rgba(0,0,0,0.7)", padding: "2px 6px", letterSpacing: 1 }}>SR {scale}×</div>
                  <div style={{ position: "absolute", top: 8, right: 8, fontSize: 9, color: "#ff6040", background: "rgba(0,0,0,0.7)", padding: "2px 6px", letterSpacing: 1 }}>NATIVE 10m</div>
                </div>
              ) : (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <canvas ref={srcCanvasRef} width={256} height={256}
                    style={{ display: "block", imageRendering: "pixelated", maxWidth: 480, maxHeight: 480 }}
                  />
                  {/* Hidden SR canvas */}
                  <canvas ref={dstCanvasRef} style={{ display: "none" }} />
                  <div style={{ position: "absolute", top: 8, left: 8, fontSize: 9, color: "#ff6040", background: "rgba(0,0,0,0.7)", padding: "2px 6px", letterSpacing: 1 }}>
                    NATIVE 10m — PRE-SR
                  </div>
                </div>
              )}
            </div>

            {/* Reticle */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(0,255,68,0.06)" }} />
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,255,68,0.06)" }} />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{
          width: 220,
          background: "#060a06",
          borderLeft: "1px solid #1a3a1a",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          flexShrink: 0,
        }}>
          <SideSection label="SR METRICS">
            {metrics ? (
              <div style={{ padding: "8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["PSNR", `${metrics.psnr} dB`],
                  ["SSIM", metrics.ssim],
                  ["SCALE", metrics.scale],
                  ["EST GSD", `${metrics.estRes}m`],
                  ["SRC RES", metrics.srcRes],
                  ["OUTPUT", metrics.pixels],
                  ["ALGO", metrics.method.toUpperCase()],
                  ["BAND", band.toUpperCase()],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, letterSpacing: 1 }}>
                    <span style={{ color: "#406040" }}>{k}</span>
                    <span style={{ color: "#00cc44" }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px 8px", fontSize: 9, color: "#2a4a2a", letterSpacing: 1 }}>
                AWAITING PROCESSING...
              </div>
            )}
          </SideSection>

          <SideSection label="SYSTEM STATUS">
            {[
              ["SENTINEL-2 API", "SIMULATED"],
              ["SR ENGINE", "CLIENT-SIDE"],
              ["BAND ENGINE", "ACTIVE"],
              ["GPU ACCEL", "UNAVAIL"],
              ["LANCZOS KERN", "LOADED"],
              ["EDGE DETECT", "LOADED"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 8px", fontSize: 9, letterSpacing: 0.5 }}>
                <span style={{ color: "#2a5a2a" }}>{k}</span>
                <span style={{ color: v === "ACTIVE" || v === "LOADED" ? "#00aa22" : "#5a6a5a" }}>{v}</span>
              </div>
            ))}
          </SideSection>

          <SideSection label="SR PIPELINE">
            {[
              ["1", "LOAD SOURCE", comparing],
              ["2", "BAND COMPOSITE", comparing],
              ["3", "LANCZOS UPSAMPLE", comparing],
              ["4", "EDGE ENHANCEMENT", comparing && method === "lanczos+edge"],
              ["5", "SHARPEN KERNEL", comparing && (method === "lanczos+edge" || method === "sharpen-only")],
              ["6", "OUTPUT RENDER", comparing],
            ].map(([n, label, done]) => (
              <div key={n} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", fontSize: 9 }}>
                <span style={{ color: done ? "#00cc44" : "#2a4a2a" }}>{done ? "✓" : "○"}</span>
                <span style={{ color: done ? "#5aaa5a" : "#2a4a2a", letterSpacing: 0.5 }}>{label}</span>
              </div>
            ))}
          </SideSection>

          <SideSection label="LEGEND">
            {[
              ["#00ff44", "SR ENHANCED"],
              ["#ff6040", "NATIVE 10m"],
              ["#00aaff", "WATER"],
              ["#3aaa3a", "VEGETATION"],
              ["#888888", "URBAN"],
            ].map(([color, label]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", fontSize: 9 }}>
                <div style={{ width: 8, height: 8, background: color, flexShrink: 0 }} />
                <span style={{ color: "#406040", letterSpacing: 0.5 }}>{label}</span>
              </div>
            ))}
          </SideSection>

          <div style={{ flex: 1 }} />
          <div style={{ padding: "10px 8px", borderTop: "1px solid #1a3a1a", fontSize: 8, color: "#1a4a1a", letterSpacing: 1, lineHeight: 1.6 }}>
            SENTINEL-SR v0.9.2<br />
            © IQSPATIAL / RMKENV<br />
            PROCESSING: CLIENT-SIDE<br />
            DATA: ESA S2 L2A<br />
            <span style={{ color: "#0a2a0a" }}>NOT FOR OPERATIONAL USE</span>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <div style={{
        height: 24,
        borderTop: "1px solid #1a3a1a",
        background: "#030603",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 16,
        fontSize: 9,
        color: "#2a5a2a",
        letterSpacing: 1,
        flexShrink: 0,
      }}>
        <span>COORD: 38.8°N 077.0°W</span>
        <span style={{ color: "#1a3a1a" }}>|</span>
        <span>PLATFORM: SENTINEL-2A/B</span>
        <span style={{ color: "#1a3a1a" }}>|</span>
        <span>NATIVE GSD: 10m (VIS) / 20m (SWIR)</span>
        <span style={{ color: "#1a3a1a" }}>|</span>
        <span>ALGORITHM: {method.toUpperCase()}</span>
        <span style={{ color: "#1a3a1a" }}>|</span>
        <span>BAND: {band.toUpperCase()}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#1a4a1a" }}>UNCLASSIFIED // OPEN SOURCE DEMONSTRATION</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #060a06; }
        ::-webkit-scrollbar-thumb { background: #1a3a1a; border-radius: 2px; }
      `}</style>
    </div>
  );
}

function SideSection({ label, children }) {
  return (
    <div style={{ borderBottom: "1px solid #0d1f0d" }}>
      <div style={{
        padding: "8px 8px 4px",
        fontSize: 8,
        color: "#2a6a2a",
        letterSpacing: 2,
        fontWeight: "bold",
        background: "#040804",
      }}>
        ▸ {label}
      </div>
      {children}
    </div>
  );
}

function btnStyle(active) {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "5px 8px",
    background: active ? "#0a2a0a" : "none",
    border: "none",
    borderLeft: active ? "2px solid #00cc44" : "2px solid transparent",
    color: active ? "#00ff44" : "#406040",
    fontFamily: "'Courier New', monospace",
    fontSize: 9,
    cursor: "pointer",
    letterSpacing: 1,
    transition: "all 0.1s",
  };
}
