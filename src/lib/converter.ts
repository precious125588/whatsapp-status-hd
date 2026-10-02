// Browser-only: ffmpeg.wasm runs inside its own Web Worker (managed by @ffmpeg/ffmpeg).
export type Orientation = "vertical" | "horizontal";
export type Quality = "hd" | "4k";
export type Fit = "crop" | "canvas";
export type Part = { name: string; blob: Blob; url: string; size: number };
export type Settings = { orientation: Orientation; quality: Quality; fit: Fit };

const CDNS = [
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
  "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
];
export const SEG = 90; // WhatsApp Status supports up to 1:30 per post
let ffmpegPromise: Promise<any> | null = null;
let current: any = null;
let cancelled = false;

export function isSupported() {
  return typeof window !== "undefined" && typeof WebAssembly === "object" && typeof Worker !== "undefined";
}

export function dims(s: Settings): [number, number] {
  const big = s.quality === "4k";
  if (s.orientation === "vertical") return big ? [2160, 3840] : [1080, 1920];
  return big ? [3840, 2160] : [1280, 720];
}

// Download a file with byte progress, return a blob URL.
async function fetchWithProgress(url: string, type: string, onBytes: (n: number) => void) {
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
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type }));
}

async function getFFmpeg(onLoad: (mb: number) => void) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      let lastErr: unknown;
      for (const base of CDNS) {
        try {
          let total = 0;
          const tick = (n: number) => { total += n; onLoad(total / 1048576); };
          const coreURL = await fetchWithProgress(`${base}/ffmpeg-core.js`, "text/javascript", tick);
          const wasmURL = await fetchWithProgress(`${base}/ffmpeg-core.wasm`, "application/wasm", tick);
          const ff = new FFmpeg();
          await ff.load({ coreURL, wasmURL });
          return ff;
        } catch (e) { lastErr = e; }
      }
      throw lastErr;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  return ffmpegPromise;
}

/** Stop the running conversion immediately. */
export function cancelConversion() {
  cancelled = true;
  if (current) {
    try { current.terminate(); } catch { /* already gone */ }
  }
  current = null;
  ffmpegPromise = null; // engine must be reloaded after terminate
}

export function buildArgs(s: Settings, start: number, len: number, out: string) {
  const [w, h] = dims(s);
  const sharpen = "unsharp=5:5:0.8:3:3:0.4";
  const vf = s.fit === "canvas"
    ? `split[a][b];[a]scale=${w / 4}:${h / 4}:force_original_aspect_ratio=increase,crop=${w / 4}:${h / 4},boxblur=10:2,scale=${w}:${h}[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${sharpen},setsar=1`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},${sharpen},setsar=1`;
  const is4k = s.quality === "4k";
  return [
    "-ss", String(start), "-t", String(len), "-i", "input",
    "-vf", vf,
    "-c:v", "libx264", "-profile:v", "high", "-level:v", is4k ? "5.1" : "4.2",
    "-crf", "28", "-preset", "slow",
    "-b:v", is4k ? "8000k" : "2500k", "-maxrate", is4k ? "10000k" : "3000k", "-bufsize", is4k ? "20000k" : "6000k",
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
  onProgress(0, "Downloading converter engine (one time, ~31MB)…");
  const ff = await getFFmpeg((mb) => onProgress(0, `Downloading converter engine… ${mb.toFixed(1)} / ~31MB`));
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
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
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
