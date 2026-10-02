import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Upload, Download, Share2, Smartphone, Monitor, Zap, ShieldCheck, Film, AlertTriangle,
  X, Play, History, Trash2, Crop, Frame,
} from "lucide-react";
import {
  cancelConversion, convert, dims, fmtBytes, fmtTime, isSupported, shareToWhatsApp, SEG,
  type Fit, type Orientation, type Part, type Quality,
} from "@/lib/converter";
import { addHistory, clearHistory, deleteHistory, listHistory, type HistoryItem } from "@/lib/history";

const SITE = "https://status-magic-converter.lovable.app";
const TITLE = "WhatsApp Status HD Converter — Pinterest 4K Trick";
const DESC = "Drop any video (Free Fire clips & more) and get crisp WhatsApp Status files. Pinterest 4K trick, 9:16 canvas, auto-split into 1:30 parts, 100% in your browser.";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE },
      { property: "og:image", content: `${SITE}/og.jpg` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "twitter:image", content: `${SITE}/og.jpg` },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
});

type Info = { file: File; url: string; duration: number; w: number; h: number };

function Toggle<T extends string>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; disabled?: boolean;
  options: { v: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex flex-wrap justify-center rounded-full border border-border bg-card p-1">
      {options.map((o) => (
        <button key={o.v} disabled={disabled} onClick={() => onChange(o.v)}
          className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition sm:px-4 sm:text-sm disabled:opacity-50 ${value === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function Index() {
  const [supported, setSupported] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>("vertical");
  const [quality, setQuality] = useState<Quality>("hd");
  const [fit, setFit] = useState<Fit>("crop");
  const [auto, setAuto] = useState(true);
  const [info, setInfo] = useState<Info | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [eta, setEta] = useState<number | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const settings = { orientation, quality, fit };
  const [ow, oh] = dims(settings);

  useEffect(() => {
    setSupported(isSupported());
    try { setAuto(localStorage.getItem("autoConvert") !== "off"); } catch { /* ignore */ }
    listHistory().then(setHistory).catch(() => {});
  }, []);

  function toggleAuto() {
    const v = !auto;
    setAuto(v);
    try { localStorage.setItem("autoConvert", v ? "on" : "off"); } catch { /* ignore */ }
  }

  async function run(i: Info) {
    const id = ++runId.current;
    setBusy(true); setError(""); setParts([]); setProgress(0); setEta(null);
    let t0 = 0;
    try {
      const res = await convert(i.file, i.duration, settings, (p, s) => {
        if (id !== runId.current) return;
        setProgress(p); setStage(s);
        if (p > 0 && !t0) t0 = Date.now();
        if (t0 && p > 1 && p < 100) setEta(((Date.now() - t0) / p) * (100 - p) / 1000);
      });
      if (id !== runId.current) return;
      setParts(res);
      const item: HistoryItem = {
        id: `${Date.now()}`, date: Date.now(), source: i.file.name, sourceSize: i.file.size,
        sourceRes: i.w ? `${i.w}×${i.h}` : "—", outRes: `${ow}×${oh}`,
        parts: res.map((p) => ({ name: p.name, size: p.size, blob: p.blob })),
      };
      addHistory(item).then(() => listHistory().then(setHistory)).catch(() => {});
    } catch (e) {
      if (id !== runId.current) return;
      console.error(e);
      setError(String(e).includes("cancelled") ? "" : "Conversion failed. Check your internet (engine downloads once) or try a shorter / smaller video.");
    } finally {
      if (id === runId.current) { setBusy(false); setEta(null); }
    }
  }

  function cancel() {
    runId.current++;
    cancelConversion();
    setBusy(false); setProgress(0); setStage(""); setEta(null);
  }

  function remove() {
    if (busy) cancel();
    if (info) URL.revokeObjectURL(info.url);
    setInfo(null); setParts([]); setError("");
  }

  function handleFile(file?: File) {
    if (!file) return;
    if (!/\.(mp4|mov|mkv|webm)$/i.test(file.name) && !file.type.startsWith("video/")) {
      setError("Please use an mp4, mov, mkv or webm video."); return;
    }
    if (busy) cancel();
    setParts([]); setError("");
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    const done = (i: Info) => { setInfo(i); if (auto) run(i); };
    v.onloadedmetadata = () => done({ file, url, duration: v.duration || 0, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => done({ file, url, duration: SEG, w: 0, h: 0 });
    v.src = url;
  }

  const totalOut = parts.reduce((a, p) => a + p.size, 0);
  const frameAspect = orientation === "vertical" ? "aspect-[9/16]" : "aspect-video";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,var(--glow),transparent_60%)]" />
      <main className="relative mx-auto max-w-4xl px-4 py-10 sm:py-16">
        <header className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Zap className="h-3.5 w-3.5" /> Pinterest 4K Trick
          </span>
          <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-6xl">
            WhatsApp Status <span className="text-primary">HD</span> Converter
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Pinterest 4K Trick - Small size, no quality loss on WhatsApp Status
          </p>
        </header>

        {!supported && (
          <div className="mt-8 flex gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            Your browser can't run the converter. Please open this page in the latest Chrome, Edge, Firefox or Safari.
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Toggle value={orientation} onChange={setOrientation} disabled={busy} options={[
            { v: "vertical", label: "Vertical (9:16) for Status", icon: <Smartphone className="h-4 w-4" /> },
            { v: "horizontal", label: "Horizontal (16:9)", icon: <Monitor className="h-4 w-4" /> },
          ]} />
          <div className="flex flex-wrap justify-center gap-3">
            <Toggle value={fit} onChange={setFit} disabled={busy} options={[
              { v: "crop", label: "Fill & crop", icon: <Crop className="h-4 w-4" /> },
              { v: "canvas", label: "Canvas (blur bars)", icon: <Frame className="h-4 w-4" /> },
            ]} />
            <Toggle value={quality} onChange={setQuality} disabled={busy} options={[
              { v: "hd", label: "HD 1080p" },
              { v: "4k", label: "True 4K" },
            ]} />
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <button role="switch" aria-checked={auto} aria-label="Auto convert" onClick={toggleAuto}
              className={`relative h-6 w-11 rounded-full transition ${auto ? "bg-primary" : "bg-muted"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-all ${auto ? "left-[22px]" : "left-0.5"}`} />
            </button>
            Auto convert on drop: <b>{auto ? "ON" : "OFF"}</b>
          </label>
          {quality === "4k" && (
            <p className="max-w-lg text-center text-xs text-muted-foreground">
              True 4K = {ow}×{oh}. It takes about 4× longer and needs a strong phone/PC. WhatsApp Status itself plays at up to 1080p, so HD is usually the sharpest result there.
            </p>
          )}
        </div>

        {!info && (
          <div
            role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            className={`mt-6 cursor-pointer rounded-3xl border-2 border-dashed p-10 text-center transition sm:p-16 ${drag ? "border-primary bg-primary/10" : "border-border bg-card/60 hover:border-primary/60"}`}>
            <Upload className="mx-auto h-12 w-12 text-primary" />
            <p className="mt-4 font-display text-2xl font-semibold">Drop your video here</p>
            <p className="mt-1 text-sm text-muted-foreground">or click to browse · mp4, mov, mkv, webm · {auto ? "converts automatically" : "then press Convert"}</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm" className="hidden"
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />

        {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}

        {info && (
          <section className="mt-6 grid gap-6 rounded-3xl border border-border bg-card p-5 sm:grid-cols-[220px_1fr]">
            <div className={`relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border-4 border-muted bg-background ${frameAspect}`}>
              {fit === "canvas" && <video src={info.url} muted autoPlay loop playsInline className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md" />}
              <video src={info.url} controls muted playsInline className={`relative h-full w-full ${fit === "canvas" ? "object-contain" : "object-cover"}`} />
              <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold">{orientation === "vertical" ? "9:16" : "16:9"} canvas</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <p className="flex-1 truncate font-semibold"><Film className="mr-2 inline h-4 w-4 text-primary" />{info.file.name}</p>
                <button onClick={remove} aria-label="Remove video" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {fmtTime(info.duration)} · {fmtBytes(info.file.size)} · {info.w ? `${info.w}×${info.h}` : "unknown res"}
                {info.duration > SEG && ` · will split into ${Math.ceil(info.duration / SEG - 0.01)} parts of 1:30`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Output: {ow}×{oh} · {fit === "canvas" ? "full video on blurred canvas" : "fill & crop"}</p>

              {busy ? (
                <div className="mt-5">
                  <div className="flex justify-between gap-2 text-sm"><span>{stage}</span><span className="font-mono">{progress.toFixed(0)}%</span></div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full bg-primary transition-all ${progress === 0 ? "w-1/4 animate-pulse" : ""}`} style={progress > 0 ? { width: `${progress}%` } : undefined} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Estimated time left: {eta != null ? fmtTime(eta) : "calculating…"} · keep this tab open & screen on</p>
                  <button onClick={cancel} className="mt-4 inline-flex items-center gap-2 rounded-full border border-destructive/60 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10">
                    <X className="h-4 w-4" /> Cancel conversion
                  </button>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={() => run(info)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">
                    <Play className="h-4 w-4" /> {parts.length ? "Convert again" : "Convert"}
                  </button>
                  <button onClick={() => inputRef.current?.click()} className="rounded-full border border-border px-4 py-2.5 text-sm">Choose another video</button>
                </div>
              )}
            </div>
          </section>
        )}

        {parts.length > 0 && info && (
          <section className="mt-6 rounded-3xl border border-primary/40 bg-card p-5">
            <h2 className="font-display text-xl font-bold">Before vs After</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted p-4"><p className="text-muted-foreground">Original</p><p className="mt-1 text-lg font-semibold">{fmtBytes(info.file.size)}</p><p>{info.w ? `${info.w}×${info.h}` : "—"}</p></div>
              <div className="rounded-xl bg-primary/15 p-4"><p className="text-primary">{quality === "4k" ? "4K Status" : "HD Status"}</p><p className="mt-1 text-lg font-semibold">{fmtBytes(totalOut)}</p><p>{ow}×{oh} · 30fps</p></div>
            </div>
            <div className="mt-5 space-y-3">
              {parts.map((p, i) => (
                <div key={p.name} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                  <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                  <a href={p.url} download={p.name} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    <Download className="h-4 w-4" /> Download Part {i + 1} ({fmtBytes(p.size)} - {quality === "4k" ? "4K" : "HD"})
                  </a>
                  <button onClick={() => shareToWhatsApp(p).catch(() => {})} className="inline-flex items-center justify-center gap-2 rounded-full bg-whatsapp px-4 py-2 text-sm font-semibold text-whatsapp-foreground">
                    <Share2 className="h-4 w-4" /> Share to WhatsApp
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-xl bg-muted p-3 text-sm">
              {parts.length > 1 ? "Post Part 1, then Part 2 on WhatsApp Status - WhatsApp will NOT compress again." : "Post it on WhatsApp Status - WhatsApp will NOT compress again."}
              {" "}On phones, "Share to WhatsApp" opens the share sheet — pick WhatsApp → My Status.
            </p>
          </section>
        )}

        <section className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            ["Resolution", `${ow}×${oh} · Lanczos upscale`],
            ["Sharpen", "unsharp 5:5:0.8:3:3:0.4"],
            ["Video", `H.264 High ${quality === "4k" ? "5.1" : "4.2"} · yuv420p`],
            ["Quality", "CRF 28 · preset slow"],
            ["Bitrate", quality === "4k" ? "8000k · max 10000k · buf 20000k" : "2500k · max 3000k · buf 6000k"],
            ["Audio / FPS", "AAC 96k · 30fps CFR · faststart"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-card/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{k}</p>
              <p className="mt-1 font-mono text-sm">{v}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><History className="h-5 w-5 text-primary" /> History</h2>
            {history.length > 0 && (
              <button onClick={() => clearHistory().then(() => setHistory([]))} className="text-xs text-muted-foreground hover:text-destructive">Clear all</button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Videos you convert will show up here (saved on this device only).</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.map((h) => (
                <li key={h.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{h.source}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(h.date).toLocaleString()} · {h.sourceRes} → {h.outRes} · {fmtBytes(h.sourceSize)} → {fmtBytes(h.parts.reduce((a, p) => a + p.size, 0))}
                      </p>
                    </div>
                    <button aria-label="Delete from history" onClick={() => deleteHistory(h.id).then(() => listHistory().then(setHistory))} className="rounded-full p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {h.parts.map((p, i) => (
                      <HistoryPart key={p.name} name={p.name} blob={p.blob} label={`Part ${i + 1} (${fmtBytes(p.size)})`} />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 rounded-3xl border border-border bg-card p-6">
          <h2 className="font-display text-2xl font-bold">Why Pinterest videos stay sharp and game clips blur</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>• WhatsApp re-compresses any Status that's too big, too long, or has an odd format — 60fps game clips get crushed hard.</li>
            <li>• Pinterest-style videos are already 1080×1920, 30fps, H.264 with a modest bitrate — WhatsApp sees nothing to fix and leaves them alone.</li>
            <li>• Lanczos upscaling + light sharpening keeps edges crisp so the "fake 4K" look survives on phone screens.</li>
            <li>• Parts of up to 1:30 fit WhatsApp's Status limit, so nothing gets trimmed or re-encoded.</li>
            <li>• Canvas mode keeps your whole clip visible on a 9:16 frame with a blurred background instead of cropping the sides.</li>
          </ul>
          <p className="mt-4 flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" /> 100% private — your video never leaves your device.</p>
        </section>

        <footer className="mt-12 text-center text-sm text-muted-foreground">
          Powered by <span className="font-display font-bold text-primary">JUST X</span>
        </footer>
      </main>
    </div>
  );
}

function HistoryPart({ name, blob, label }: { name: string; blob: Blob; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <>
      <a href={url} download={name} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium hover:bg-primary hover:text-primary-foreground">
        <Download className="h-3.5 w-3.5" /> {label}
      </a>
      <button onClick={() => shareToWhatsApp({ name, blob, url }).catch(() => {})} className="inline-flex items-center gap-1.5 rounded-full bg-whatsapp px-3 py-1.5 text-xs font-medium text-whatsapp-foreground">
        <Share2 className="h-3.5 w-3.5" /> Share
      </button>
    </>
  );
}
