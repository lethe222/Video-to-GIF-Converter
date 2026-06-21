/**
 * GIF FORGE — Browser-side GIF encoder powered by FFmpeg WASM
 *
 * ─── PRODUCTION SERVER HEADERS (required for SharedArrayBuffer) ───
 *
 * @ffmpeg/ffmpeg v0.12.x runs FFmpeg in a Web Worker and communicates via
 * SharedArrayBuffer. Browsers gate SharedArrayBuffer behind two HTTP headers
 * that must be set on EVERY response (HTML, JS, WASM, fonts, …):
 *
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * nginx example:
 *   add_header Cross-Origin-Opener-Policy "same-origin" always;
 *   add_header Cross-Origin-Embedder-Policy "require-corp" always;
 *
 * Netlify (_headers file):
 *   /*
 *     Cross-Origin-Opener-Policy: same-origin
 *     Cross-Origin-Embedder-Policy: require-corp
 *
 * Caddy (Caddyfile):
 *   header {
 *     Cross-Origin-Opener-Policy same-origin
 *     Cross-Origin-Embedder-Policy require-corp
 *   }
 *
 * For local dev: `vite.config.ts` already configures `server.headers` so
 * `vite dev` / `vite preview` both serve the correct headers automatically.
 *
 * ─── SIMD NOTE ────────────────────────────────────────────────────────────
 * We load @ffmpeg/core (non-SIMD, non-MT) from CDN — avoids the
 * "Simd128 not supported" crash on older CPUs / some mobile browsers.
 */

import { useState, useRef, useCallback, useEffect } from "react"
import { FFmpeg } from "@ffmpeg/ffmpeg"
import { fetchFile, toBlobURL } from "@ffmpeg/util"
import { Upload, Film, Images, Download, AlertCircle, RotateCcw, Sparkles, ChevronDown, ChevronUp, Loader2, MessageSquare } from "lucide-react"
import FeedbackForm from "./components/FeedbackForm"

// ─── types ────────────────────────────────────────────────────────────────

type Mode = "video" | "images"
type Status = "idle" | "loading-ffmpeg" | "ready" | "pass1" | "pass2" | "done" | "error"

interface LogLine { ts: number; text: string }

// ─── constants ────────────────────────────────────────────────────────────

const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm"
const MAX_LOG_LINES = 120

// ─── helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function padIndex(n: number, width: number): string {
  return String(n).padStart(width, "0")
}

function scaleFilter(width: number): string {
  return `scale=${width}:-2:flags=lanczos`
}

// ─── sub-components ───────────────────────────────────────────────────────

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
    </div>
  )
}

function PresetBtn({ val, current, onClick }: { val: number; current: number; onClick: () => void }) {
  const active = val === current
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-muted text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
      }`}
    >
      {val}
    </button>
  )
}

// ─── main component ────────────────────────────────────────────────────────

export default function App() {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const fileInputVideoRef = useRef<HTMLInputElement>(null)
  const fileInputImagesRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<Mode>("video")
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [fps, setFps] = useState(12)
  const [width, setWidth] = useState(480)
  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState("")
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputSize, setOutputSize] = useState(0)
  const [errorMsg, setErrorMsg] = useState("")
  const [logs, setLogs] = useState<LogLine[]>([])
  const [showLog, setShowLog] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)

  const pushLog = useCallback((text: string) => {
    setLogs((prev) => {
      const next = [...prev, { ts: Date.now(), text }]
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next
    })
  }, [])

  useEffect(() => {
    if (showLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs, showLog])

  // ── load FFmpeg ──────────────────────────────────────────────────────────

  const loadFFmpeg = useCallback(async (): Promise<FFmpeg> => {
    if (ffmpegRef.current) return ffmpegRef.current
    setStatus("loading-ffmpeg")
    setProgressLabel("正在加载 FFmpeg WASM 引擎…")
    pushLog("Fetching ffmpeg-core.js from CDN…")
    const ff = new FFmpeg()
    ff.on("log", ({ message }) => pushLog(message))
    ff.on("progress", ({ progress: p }) => setProgress(Math.round(p * 100)))
    const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript")
    const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm")
    await ff.load({ coreURL, wasmURL })
    pushLog("FFmpeg core loaded ✓")
    ffmpegRef.current = ff
    return ff
  }, [pushLog])

  // ── convert ──────────────────────────────────────────────────────────────

  const convert = useCallback(async () => {
    setErrorMsg("")
    setOutputUrl(null)
    setProgress(0)

    let ff: FFmpeg
    try {
      ff = await loadFFmpeg()
    } catch (e) {
      setStatus("error")
      setErrorMsg(`FFmpeg 加载失败：${(e as Error).message}`)
      return
    }

    const isVideo = mode === "video"
    const hasAlpha = isVideo && videoFile?.name.toLowerCase().endsWith(".mov")

    try {
      setStatus("pass1")
      setProgressLabel("正在写入输入文件…")
      setProgress(0)

      if (isVideo) {
        if (!videoFile) return
        pushLog(`Writing ${videoFile.name}…`)
        await ff.writeFile("input.video", await fetchFile(videoFile))
      } else {
        const sorted = [...imageFiles].sort((a, b) => a.name.localeCompare(b.name))
        const padWidth = String(sorted.length).length
        for (let i = 0; i < sorted.length; i++) {
          await ff.writeFile(`frame${padIndex(i, padWidth)}.png`, await fetchFile(sorted[i]))
        }
        pushLog(`Wrote ${sorted.length} frames`)
      }

      // Pass 1 — palettegen
      setProgressLabel("第 1 步 / 共 2 步 — 生成调色板…")
      setProgress(0)

      const scale = scaleFilter(width)
      const fpsFilter = `fps=${fps}`
      const palettegenFilter = `${fpsFilter},${scale},palettegen=max_colors=256:reserve_transparent=1`

      const pass1Args: string[] = isVideo
        ? ["-i", "input.video", "-vf", palettegenFilter, "-y", "palette.png"]
        : [
            "-framerate", String(fps),
            "-i", `frame%0${String(imageFiles.length).length}d.png`,
            "-vf", `${scale},palettegen=max_colors=256:reserve_transparent=1`,
            "-y", "palette.png",
          ]

      pushLog(">> ffmpeg " + pass1Args.join(" "))
      await ff.exec(pass1Args)
      pushLog("Palette generated ✓")

      // Pass 2 — paletteuse
      setStatus("pass2")
      setProgressLabel("第 2 步 / 共 2 步 — 编码 GIF…")
      setProgress(0)

      const paletteuseOpts = hasAlpha
        ? "dither=bayer:bayer_scale=5:diff_mode=rectangle:alpha_threshold=128"
        : "dither=bayer:bayer_scale=5:diff_mode=rectangle"

      let pass2Args: string[]
      if (isVideo) {
        const srcFilter = hasAlpha ? `${fpsFilter},${scale},format=rgba` : `${fpsFilter},${scale}`
        pass2Args = [
          "-i", "input.video", "-i", "palette.png",
          "-lavfi", `${srcFilter}[x];[x][1:v]paletteuse=${paletteuseOpts}`,
          "-y", "output.gif",
        ]
      } else {
        const padW = String(imageFiles.length).length
        pass2Args = [
          "-framerate", String(fps),
          "-i", `frame%0${padW}d.png`,
          "-i", "palette.png",
          "-lavfi", `${scale},format=rgba[x];[x][1:v]paletteuse=${paletteuseOpts}`,
          "-y", "output.gif",
        ]
      }

      pushLog(">> ffmpeg " + pass2Args.join(" "))
      await ff.exec(pass2Args)
      pushLog("GIF encoded ✓")

      const data = await ff.readFile("output.gif")
      const blob = new Blob([data], { type: "image/gif" })
      setOutputUrl(URL.createObjectURL(blob))
      setOutputSize(blob.size)
      setStatus("done")
      setProgress(100)
      setProgressLabel("转换完成！")

      // cleanup
      try {
        await ff.deleteFile("output.gif")
        await ff.deleteFile("palette.png")
        if (isVideo) {
          await ff.deleteFile("input.video")
        } else {
          const sorted = [...imageFiles].sort((a, b) => a.name.localeCompare(b.name))
          const padW = String(sorted.length).length
          for (let i = 0; i < sorted.length; i++) await ff.deleteFile(`frame${padIndex(i, padW)}.png`)
        }
      } catch (_) { /* non-fatal */ }

    } catch (e) {
      setStatus("error")
      const msg = (e as Error).message ?? String(e)
      setErrorMsg(msg)
      pushLog(`ERROR: ${msg}`)
    }
  }, [mode, videoFile, imageFiles, fps, width, loadFFmpeg, pushLog])

  // ── file handlers ────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const isImageDrop = files.every((f) => f.type.startsWith("image/"))
    if (isImageDrop && files.length > 1) {
      setMode("images")
      setImageFiles(files.sort((a, b) => a.name.localeCompare(b.name)))
    } else if (files[0].type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(files[0].name)) {
      setMode("video"); setVideoFile(files[0])
    } else if (isImageDrop) {
      setMode("images"); setImageFiles(files)
    }
    setStatus("ready"); setOutputUrl(null)
  }, [])

  const handleVideoInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setVideoFile(f); setMode("video"); setStatus("ready"); setOutputUrl(null)
  }, [])

  const handleImagesInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setImageFiles(files.sort((a, b) => a.name.localeCompare(b.name)))
    setMode("images"); setStatus("ready"); setOutputUrl(null)
  }, [])

  const reset = useCallback(() => {
    setVideoFile(null); setImageFiles([])
    setOutputUrl(null); setStatus("idle")
    setProgress(0); setProgressLabel(""); setErrorMsg("")
  }, [])

  // ── derived ──────────────────────────────────────────────────────────────

  const isProcessing = status === "loading-ffmpeg" || status === "pass1" || status === "pass2"
  const hasInput = mode === "video" ? videoFile !== null : imageFiles.length > 0
  const canConvert = hasInput && !isProcessing
  const hasAlphaInput = mode === "video" && videoFile?.name.toLowerCase().endsWith(".mov")

  const inputSummary = mode === "video"
    ? videoFile ? videoFile.name : null
    : imageFiles.length > 0 ? `${imageFiles.length} frames` : null

  const progressPct = isProcessing || status === "done" ? progress : 0

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      style={{ fontFamily: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif' }}
    >
      {/* ── background decoration ── */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,110,242,0.12) 0%, transparent 70%), " +
            "radial-gradient(ellipse 60% 40% at 80% 80%, rgba(167,139,250,0.08) 0%, transparent 60%)",
        }}
      />

      <div className="relative max-w-3xl mx-auto px-5 py-10">

        {/* ── floating widgets container ── */}
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
          {/* ── feedback widget ── */}
          <button
            onClick={() => setShowFeedback(true)}
            title="用户反馈"
            className="flex items-center justify-center rounded-2xl shadow-lg hover:scale-110 transition-transform"
            style={{ width: 44, height: 44, background: "linear-gradient(135deg, #7c6ef2, #a78bfa)" }}
          >
            <MessageSquare size={20} color="white" />
          </button>

          {/* ── home link widget ── */}
          <a
            href="https://lethe222.github.io/Design-tool-collection-website/#"
            target="_blank"
            rel="noopener noreferrer"
            title="返回首页"
            className="flex items-center justify-center rounded-2xl shadow-lg hover:scale-110 transition-transform"
            style={{ width: 44, height: 44, background: "#3370FF" }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "#3370FF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1.5" fill="white" />
                <rect x="8" y="1" width="5" height="5" rx="1.5" fill="white" fillOpacity="0.6" />
                <rect x="1" y="8" width="5" height="5" rx="1.5" fill="white" fillOpacity="0.6" />
                <rect x="8" y="8" width="5" height="5" rx="1.5" fill="white" />
              </svg>
            </div>
          </a>
        </div>

        {/* ── feedback modal ── */}
        <FeedbackForm isOpen={showFeedback} onClose={() => setShowFeedback(false)} />

        {/* ── header ── */}
        <header className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-white border border-border rounded-full px-4 py-1.5 shadow-sm mb-5">
            <Sparkles size={13} className="text-primary" />
            <span className="text-xs font-semibold text-primary tracking-wide">由 FFmpeg WASM 驱动</span>
          </div>
          <h1 className="text-4xl font-extrabold text-foreground mb-2 tracking-tight">
            GIF 转换工具
          </h1>
          <p className="text-muted-foreground text-sm">
            将视频或图片序列转换为高质量 GIF —— 完全在浏览器本地运行，无需上传文件。
          </p>
        </header>

        {/* ── mode selector ── */}
        <div className="flex gap-3 mb-5">
          {(["video", "images"] as Mode[]).map((m) => {
            const Icon = m === "video" ? Film : Images
            const label = m === "video" ? "视频文件" : "图片序列"
            const active = mode === m
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold border transition-all ${
                  active
                    ? "bg-white border-primary text-primary shadow-md shadow-primary/10"
                    : "bg-white/60 border-border text-muted-foreground hover:border-accent hover:text-foreground"
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            )
          })}
        </div>

        {/* ── upload zone ── */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onClick={() => {
            if (mode === "video") fileInputVideoRef.current?.click()
            else fileInputImagesRef.current?.click()
          }}
          className={`relative cursor-pointer rounded-3xl border-2 border-dashed transition-all mb-5 overflow-hidden ${
            isDragOver
              ? "border-primary bg-primary/5 scale-[1.01]"
              : inputSummary
              ? "border-primary/40 bg-white"
              : "border-border bg-white/70 hover:border-primary/50 hover:bg-white"
          }`}
          style={{ minHeight: 160 }}
        >
          <input ref={fileInputVideoRef} type="file" accept="video/*,.mov,.mp4" className="sr-only" onChange={handleVideoInput} />
          <input ref={fileInputImagesRef} type="file" accept="image/*" multiple className="sr-only" onChange={handleImagesInput} />

          {inputSummary ? (
            /* file loaded state */
            <div className="flex items-center gap-4 px-8 py-7">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                {mode === "video" ? <Film size={22} className="text-primary" /> : <Images size={22} className="text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground truncate">{inputSummary}</div>
                {videoFile && (
                  <div className="text-xs text-muted-foreground mt-0.5">{formatBytes(videoFile.size)}</div>
                )}
                {imageFiles.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {imageFiles[0]?.name} … {imageFiles[imageFiles.length - 1]?.name}
                  </div>
                )}
                {hasAlphaInput && (
                  <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary bg-primary/8 border border-primary/20 rounded-full px-2.5 py-0.5">
                    ✦ 检测到 Alpha 透明通道
                  </span>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); reset() }}
                className="w-8 h-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          ) : (
            /* empty state */
            <div className="flex flex-col items-center justify-center py-14 px-8 gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #ede9fe, #ddd6fe)" }}>
                <Upload size={24} className="text-primary" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-foreground">
                  {mode === "video" ? "将视频拖拽至此处" : "将图片帧拖拽至此处"}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {mode === "video"
                    ? "支持 MP4、MOV —— 或点击选择文件"
                    : "支持多选 PNG，将按文件名排序"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── parameters card ── */}
        <div className="bg-white rounded-3xl border border-border shadow-sm shadow-border p-6 mb-5">
          <h2 className="text-sm font-bold text-foreground mb-5 flex items-center gap-2">
            <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs">⚙</span>
            输出参数
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">

            {/* FPS */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-foreground">帧率</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={1} max={60} value={fps}
                    onChange={(e) => setFps(Math.min(60, Math.max(1, Number(e.target.value))))}
                    className="w-14 bg-muted border border-border rounded-lg px-2 py-1 text-sm font-bold text-primary text-center focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition"
                  />
                  <span className="text-sm text-muted-foreground">fps</span>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[6, 10, 12, 15, 24].map((v) => (
                  <PresetBtn key={v} val={v} current={fps} onClick={() => setFps(v)} />
                ))}
              </div>
            </div>

            {/* Width */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-foreground">输出宽度</label>
                <span className="text-sm font-bold text-primary">{width}px</span>
              </div>
              <input
                type="number" min={64} max={1920} step={16} value={width}
                onChange={(e) => setWidth(Math.max(64, Number(e.target.value)))}
                className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition mb-3"
              />
              <div className="flex gap-1.5 flex-wrap">
                {[320, 480, 640, 800].map((v) => (
                  <PresetBtn key={v} val={v} current={width} onClick={() => setWidth(v)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── convert button ── */}
        <button
          onClick={convert}
          disabled={!canConvert}
          className="w-full py-4 rounded-2xl font-bold text-base text-primary-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2.5"
          style={{
            background: canConvert
              ? "linear-gradient(135deg, #7c6ef2, #a78bfa)"
              : "linear-gradient(135deg, #c4bbf7, #d8b4fe)",
            boxShadow: canConvert ? "0 8px 24px rgba(124,110,242,0.3)" : "none",
          }}
        >
          {isProcessing ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {progressLabel || "处理中…"}
            </>
          ) : (
            <>
              <Sparkles size={17} />
              开始转换为 GIF
            </>
          )}
        </button>

        {/* ── progress bar ── */}
        {(isProcessing || status === "done") && (
          <div className="mt-4 bg-white rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">{progressLabel}</span>
              <span className="text-xs font-bold text-primary">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressPct}%`,
                  background: "linear-gradient(90deg, #7c6ef2, #a78bfa)",
                }}
              />
            </div>
            {status === "pass1" && (
              <p className="text-xs text-muted-foreground mt-2">正在生成全局最优调色板…</p>
            )}
            {status === "pass2" && (
              <p className="text-xs text-muted-foreground mt-2">正在使用误差扩散抖动算法编码帧…</p>
            )}
          </div>
        )}

        {/* ── error ── */}
        {status === "error" && (
          <div className="mt-4 bg-white border border-destructive/30 rounded-2xl p-4 flex gap-3">
            <AlertCircle size={16} className="text-destructive mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-destructive mb-1">转换失败</div>
              <div className="text-xs text-muted-foreground break-all">{errorMsg}</div>
            </div>
          </div>
        )}

        {/* ── output preview ── */}
        {status === "done" && outputUrl && (
          <div className="mt-5 bg-white rounded-3xl border border-border shadow-sm overflow-hidden">
            {/* checkerboard bg to show transparency */}
            <div
              className="flex items-center justify-center p-6"
              style={{
                backgroundImage:
                  "repeating-conic-gradient(#f5f3ff 0% 25%, #ede9fe 0% 50%)",
                backgroundSize: "20px 20px",
              }}
            >
              <img
                src={outputUrl}
                alt="Generated GIF"
                className="max-w-full max-h-[50vh] rounded-xl shadow-lg"
              />
            </div>
            <div className="border-t border-border px-6 py-4 flex items-center gap-6 flex-wrap">
              <StatBadge label="文件大小" value={formatBytes(outputSize)} color="text-foreground" />
              <StatBadge label="帧率" value={`${fps} fps`} color="text-foreground" />
              <StatBadge label="宽度" value={`${width}px`} color="text-foreground" />
              <div className="ml-auto">
                <a
                  href={outputUrl}
                  download="output.gif"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-primary-foreground transition-all"
                  style={{
                    background: "linear-gradient(135deg, #7c6ef2, #a78bfa)",
                    boxShadow: "0 4px 14px rgba(124,110,242,0.3)",
                  }}
                >
                  <Download size={14} />
                  下载 GIF
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── log console (collapsible) ── */}
        <div className="mt-5 bg-white rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setShowLog((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="font-semibold tracking-wide">FFmpeg 日志</span>
            <div className="flex items-center gap-2">
              <span className="bg-muted rounded-full px-2 py-0.5 text-[11px]">{logs.length} lines</span>
              {showLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </div>
          </button>
          {showLog && (
            <div
              className="h-48 overflow-y-auto border-t border-border bg-muted px-5 py-3"
              style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 11 }}
            >
              {logs.length === 0 ? (
                <span className="text-muted-foreground">暂无日志输出。</span>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="text-muted-foreground leading-relaxed whitespace-pre-wrap break-all hover:text-foreground transition-colors">
                    <span className="opacity-30 mr-2 select-none">{String(i + 1).padStart(4, "0")}</span>
                    {l.text}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

        {/* ── footer ── */}
        <footer className="mt-10 text-center text-xs text-muted-foreground">
          所有处理均在本地浏览器完成 · 文件不会上传至任何服务器 · 由{" "}
          <span className="text-primary font-medium">@ffmpeg/ffmpeg v0.12</span> 驱动
        </footer>

      </div>
    </div>
  )
}
