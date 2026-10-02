// Browser-only: ffmpeg.wasm runs inside its own Web Worker (managed by @ffmpeg/ffmpeg).
export type Orientation = "vertical" | "horizontal";
export type Quality = "4k" | "1080" | "720";
export type Fit = "crop" | "canvas";
export type Part = { name: string; blob: Blob; url: string; size: number };
export type Settings = { orientation: Orientation; quality: Quality; fit: Fit };

const CDNS = [
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
  "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
];
const CACHE = "ffmpeg-core-0.12.10";
export const SEG = 90; // WhatsApp Status supports up to 1:30 per post
let ffmpegPromise: Promise<any> | null = null;
let current: any = null;
let cancelled = false;

export const PRESETS: Record<Quality, {
  label: string; v: [number, number]; level: string; b: string; max: string; buf: string;
}> = {
  "4k": { label: "4K WhatsApp friendly", v: [2160, 3840], level: "5.1", b: "8000k", max: "10000k", buf: "20000k" },
  "1080": { label: "1080p WhatsApp friendly", v: [1080, 1920], level: "4.2", b: "2500k", max: "3000k", buf: "6000k" },
  "720": { label: "720p WhatsApp friendly", v: [720, 1280], level: "4.0", b: "1500k", max: "2000k", buf: "4000k" },
};

export function isSupported() {
  return typeof window !== "undefined" && typeof WebAssembly === "object" && typeof Worker !== "undefined";
}

export function dims(s: Settings): [number, number] {
  const [a, b] = PRESETS[s.quality].v;
  return s.orientation === "vertical" ? [a, b] : [b, a];
}

// Download once, keep in the browser's Cache Storage so later visits start instantly.
async function cachedBlobURL(url: string, type: string, onBytes: (n: number) => void) {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* cache unavailable */ }
  const hit = await cache?.match(url);
  if (hit) {
    const blob = await hit.blob();
    onBytes(blob.size);
    return URL.createObjectURL(new Blob([blob], { type }));
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  const blob = new Blob(chunks as BlobPart[], { type });
  try { await cache?.put(url, new Response(blob, { headers: { "Content-Type": type } })); } catch { /* quota */ }
  return URL.createObjectURL(blob);
}

type LoadListener = (mb: number) => void;
const listeners = new Set<LoadListener>();
let engineReady = false;
export const isEngineReady = () => engineReady;

function getFFmpeg(onLoad?: LoadListener) {
  if (onLoad) listeners.add(onLoad);
  if (!ffmpegPromise) {
    engineReady = false;
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      let lastErr: unknown;
      for (const base of CDNS) {
        try {
          let total = 0;
          const tick = (n: number) => { total += n; listeners.forEach((l) => l(total / 1048576)); };
          const coreURL = await cachedBlobURL(`${base}/ffmpeg-core.js`, "text/javascript", tick);
          const wasmURL = await cachedBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm", tick);
          const ff = new FFmpeg();
          await ff.load({ coreURL, wasmURL });
          engineReady = true;
          return ff;
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  const p = ffmpegPromise;
  p.finally(() => onLoad && listeners.delete(onLoad)).catch(() => {});
  return p;
}

/** Start loading the engine in the background as soon as the page opens. */
export function preloadEngine(onLoad?: LoadListener) {
  return getFFmpeg(onLoad).then(() => true);
}

/** Stop the running conversion immediately, then warm up a fresh engine. */
export function cancelConversion() {
  cancelled = true;
  if (current) {
    try { current.terminate(); } catch { /* already gone */ }
  }
  current = null;
  ffmpegPromise = null;
  engineReady = false;
  getFFmpeg().catch(() => {}); // reloads from cache — ready again in seconds
}

export function buildArgs(s: Settings, start: number, len: number, out: string) {
  const [w, h] = dims(s);
  const p = PRESETS[s.quality];
  const sharpen = "unsharp=5:5:0.8:3:3:0.4";
  const bw = Math.round(w / 8) * 2, bh = Math.round(h / 8) * 2;
  const vf = s.fit === "canvas"
    ? `split[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=10:2,scale=${w}:${h}[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${sharpen},setsar=1`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},${sharpen},setsar=1`;
  return [
    "-ss", String(start), "-t", String(len), "-i", "input",
    "-vf", vf,
    "-c:v", "libx264", "-profile:v", "high", "-level:v", p.level,
    "-crf", "28", "-preset", "slow",
    "-b:v", p.b, "-maxrate", p.max, "-bufsize", p.buf,
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    "-r", "30", "-fps_mode", "cfr", "-movflags", "+faststart", out,
  ];
}

export async function convert(
  file: File,
  duration: number,
  s: Settings,
  onProgress: (p: number, stage: string) => void,
): Promise<Part[]> {
  cancelled = false;
  if (!engineReady) onProgress(0, "Getting converter engine ready…");
  const ff = await getFFmpeg((mb) => onProgress(0, `Getting converter engine ready… ${mb.toFixed(1)} / ~31MB`));
  current = ff;
  if (cancelled) throw new Error("cancelled");
  onProgress(0, "Reading your video…");
  const { fetchFile } = await import("@ffmpeg/util");
  await ff.writeFile("input", await fetchFile(file));
  const count = Math.max(1, Math.ceil(duration / SEG - 0.01));
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * SEG;
    const len = Math.min(SEG, duration - start);
    const name = count > 1 ? `part${i + 1}_status.mp4` : "status.mp4";
    const stage = `Converting part ${i + 1} of ${count}…`;
    onProgress((i / count) * 100, stage);
    // Parse "time=00:00:12.34" from logs — more reliable than the progress event.
    const logHandler = ({ message }: { message: string }) => {
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(message);
      if (!m) return;
      const t = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
      const p = Math.min(1, Math.max(0, t / len));
      onProgress(((i + p) / count) * 100, stage);
    };
    ff.on("log", logHandler);
    try {
      const code = await ff.exec(buildArgs(s, start, len, name));
      if (cancelled) throw new Error("cancelled");
      if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    } finally {
      ff.off("log", logHandler);
    }
    const data = (await ff.readFile(name)) as Uint8Array;
    await ff.deleteFile(name);
    const blob = new Blob([data.slice()], { type: "video/mp4" });
    parts.push({ name, blob, url: URL.createObjectURL(blob), size: blob.size });
  }
  await ff.deleteFile("input");
  current = null;
  onProgress(100, "Done");
  return parts;
}

export function fmtBytes(b: number) {
  return b > 1e6 ? `${(b / 1048576).toFixed(1)}MB` : `${(b / 1024).toFixed(0)}KB`;
}
export function fmtTime(s: number) {
  if (!isFinite(s)) return "--";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export async function shareToWhatsApp(part: { name: string; blob: Blob; url: string }) {
  const file = new File([part.blob], part.name, { type: "video/mp4" });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: part.name, text: "WhatsApp Status HD" });
    return "shared";
  }
  const a = document.createElement("a");
  a.href = part.url;
  a.download = part.name;
  a.click();
  window.open("https://wa.me/", "_blank");
  return "fallback";
}
