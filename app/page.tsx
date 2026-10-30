"use client";

// 客人取件页：输入取件码 → 缩略图画廊 → 单张/打包下载
import { useCallback, useEffect, useState } from "react";
import { downloadZip } from "client-zip";
import { normalizeCode } from "@/lib/codes";

type FileEntry = {
  seq: number;
  name: string;
  size: number;
  url: string;
  thumb?: string;
};

type Gallery = { name: string; expiresAt: number; files: FileEntry[] };

function fmtSize(n: number): string {
  if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 先整份拉下来再存，这样下载下来的文件名是原始文件名
async function downloadOne(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("下载失败");
  saveBlob(await res.blob(), filename);
}

export default function HomePage() {
  const [raw, setRaw] = useState(""); // 8 位无横线取件码
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [note, setNote] = useState("");

  // 支持 ?code=XXXX-XXXX 的直达链接（老师可以直接把这个链接发给客人）
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setRaw(normalizeCode(c));
  }, []);

  const submit = useCallback(async () => {
    const code = normalizeCode(raw);
    if (code.length !== 8) {
      setError("取件码是 8 位字母数字");
      setPhase("error");
      return;
    }
    setPhase("loading");
    setError("");
    try {
      const res = await fetch(`/api/pickup/${code}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取失败");
      setGallery(data);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误，请重试");
      setPhase("error");
    }
  }, [raw]);

  // 灯箱键盘操作：Esc 关闭、左右切图
  useEffect(() => {
    if (viewer === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      if (!gallery) return;
      if (e.key === "ArrowLeft" && viewer > 0) setViewer(viewer - 1);
      if (e.key === "ArrowRight" && viewer < gallery.files.length - 1) setViewer(viewer + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, gallery]);

  // 在浏览器里流式打包成 ZIP（client-zip），不用服务器出力
  async function zipAll() {
    if (!gallery || zipBusy) return;
    setZipBusy(true);
    setNote("");
    try {
      // 异步生成器逐张拉取，client-zip 边拉边打包，不一次性占满内存
      const items = async function* () {
        for (const f of gallery.files) {
          yield { name: f.name, input: await fetch(f.url) };
        }
      };
      const blob = await downloadZip(items()).blob();
      saveBlob(blob, `照片-${normalizeCode(raw)}.zip`);
    } catch {
      setNote("打包失败（相册太大或网络不稳），请改用逐张下载");
    }
    setZipBusy(false);
  }

  async function downloadEach() {
    if (!gallery) return;
    setNote("开始逐张下载，浏览器若询问“允许下载多个文件”请点允许…");
    let fail = 0;
    for (const f of gallery.files) {
      try {
        await downloadOne(f.url, f.name);
      } catch {
        fail++;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    setNote(fail ? `完成，其中 ${fail} 张失败，可点开大图单独重下` : "全部下载完成 ✔");
  }

  const display = raw.length > 4 ? raw.slice(0, 4) + "-" + raw.slice(4) : raw;

  /* ---------- 入口视图 ---------- */
  if (phase !== "done" || !gallery) {
    return (
      <main className="hero">
        <div className="hero-card">
          <div className="hero-logo">📷</div>
          <h1>照片取件</h1>
          <p className="muted">输入取件码，下载原画质照片</p>
          <input
            className="code-input"
            value={display}
            onChange={(e) => setRaw(normalizeCode(e.target.value).slice(0, 8))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="XXXX-XXXX"
            maxLength={9}
            autoFocus
            spellCheck={false}
          />
          <button className="btn btn-primary btn-block" onClick={submit} disabled={phase === "loading"}>
            {phase === "loading" ? "查询中…" : "获取照片"}
          </button>
          {phase === "error" && <p className="error-text">{error}</p>}
          <p className="tiny muted">取件码由摄影师提供 · 大小写与横线均可</p>
        </div>
      </main>
    );
  }

  /* ---------- 画廊视图 ---------- */
  return (
    <main className="wrap">
      <header className="gallery-head">
        <div>
          <h1>{gallery.name}</h1>
          <p className="muted">
            {gallery.files.length} 张 · 有效期至 {fmtDate(gallery.expiresAt)} · 原画质无压缩
          </p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={zipAll} disabled={zipBusy}>
            {zipBusy ? "打包中…" : "打包下载 ZIP"}
          </button>
          <button className="btn btn-ghost" onClick={downloadEach}>
            逐张下载
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setGallery(null);
              setPhase("idle");
              setRaw("");
              setNote("");
            }}
          >
            换一个码
          </button>
        </div>
      </header>
      {note && <p className="note">{note}</p>}

      <div className="gallery">
        {gallery.files.map((f, i) => (
          <button key={f.seq} className="ph" onClick={() => setViewer(i)} title={f.name}>
            {f.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.thumb} alt={f.name} loading="lazy" />
            ) : (
              <span className="ph-holder">🖼</span>
            )}
            <span className="ph-cap">
              <span className="ph-name">{f.name}</span>
              <span className="muted">{fmtSize(f.size)}</span>
            </span>
          </button>
        ))}
      </div>

      {viewer !== null && gallery.files[viewer] && (
        <div className="modal-overlay" onClick={() => setViewer(null)}>
          <div className="modal-bar" onClick={(e) => e.stopPropagation()}>
            <span className="ph-name">
              {gallery.files[viewer].name} · {fmtSize(gallery.files[viewer].size)}
            </span>
            <span className="row">
              <button
                className="btn btn-primary btn-sm"
                onClick={() =>
                  downloadOne(gallery.files[viewer!].url, gallery.files[viewer!].name)
                }
              >
                下载原图
              </button>
              <button className="icon-btn" onClick={() => setViewer(null)}>
                ✕
              </button>
            </span>
          </div>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            {viewer > 0 && (
              <button className="nav-btn left" onClick={() => setViewer(viewer - 1)}>
                ‹
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="modal-img"
              src={gallery.files[viewer].url}
              alt={gallery.files[viewer].name}
            />
            {viewer < gallery.files.length - 1 && (
              <button className="nav-btn right" onClick={() => setViewer(viewer + 1)}>
                ›
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
