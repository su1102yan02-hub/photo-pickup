"use client";

// 摄影师管理端：登录 → 新建相册（自动生成取件码）→ 批量上传照片
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { makeThumb } from "@/lib/thumb";

type BatchInfo = {
  batchId: string;
  codeKey: string;
  code: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
};

type Task = {
  id: string;
  file: File;
  seq: number;
  status: "等待中" | "上传中" | "完成" | "失败";
  progress: number;
  error?: string;
};

const DAYS_OPTIONS = [3, 7, 14];

function fmtDate(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysLeft(expiresAt: number) {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [newName, setNewName] = useState("");
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<BatchInfo | null>(null);
  const [batchReady, setBatchReady] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState("");
  const nextSeq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/batches", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json().catch(() => null as { batches?: BatchInfo[]; error?: string } | null);
      if (!res.ok || !data) {
        setAuthed(true); // 已登录但加载失败，进管理页显示错误，别把人踢回登录页
        setNote(data?.error || `加载相册列表失败（HTTP ${res.status}）`);
        return;
      }
      setBatches(data.batches ?? []);
      setAuthed(true);
    } catch {
      setAuthed(false);
      setNote("网络错误，请刷新重试");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLogin() {
    setLoginError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError("密码不对");
      return;
    }
    setPassword("");
    load();
  }

  async function doLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
    setBatches([]);
    setSelected(null);
    setTasks([]);
  }

  async function createBatch() {
    if (creating) return;
    setCreating(true);
    setNote("");
    try {
      const res = await fetch("/api/admin/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName, days }),
      });
      const data = await res.json().catch(() => null as { error?: string; batch?: BatchInfo } | null);
      if (!res.ok || !data?.batch) throw new Error(data?.error || `创建失败（HTTP ${res.status}）`);
      setBatches((bs) => [data.batch!, ...bs]);
      setNewName("");
      await selectBatch(data.batch);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "创建失败");
    }
    setCreating(false);
  }

  // 选中相册后先查一下已有张数，续传时序号接在后面，不覆盖老照片
  async function selectBatch(b: BatchInfo) {
    setSelected(b);
    setTasks([]);
    setNote("");
    setBatchReady(false);
    try {
      const res = await fetch(`/api/pickup/${b.codeKey}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        nextSeq.current = data.files?.length
          ? data.files[data.files.length - 1].seq + 1
          : 0;
      } else {
        nextSeq.current = 0;
      }
    } catch {
      nextSeq.current = 0;
    }
    setBatchReady(true);
  }

  function update(id: string, patch: Partial<Task>) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // 直传一个文件到 Blob（走 /api/auth-upload 签发的凭证）
  async function uploadBlob(pathname: string, file: File, taskId: string) {
    type UploadOpts = NonNullable<Parameters<typeof upload>[2]>;
    const opts: UploadOpts & { onUploadProgress?: (p: { percentage: number }) => void } = {
      access: "public",
      handleUploadUrl: "/api/auth-upload",
      // 客户端直传默认不加随机后缀，路径可预测，靠前缀就能列举
      onUploadProgress: (p) => update(taskId, { progress: p.percentage }),
    };
    await upload(pathname, file, opts);
  }

  async function uploadTask(batch: BatchInfo, task: Task): Promise<boolean> {
    update(task.id, { status: "上传中", progress: 0 });
    try {
      // 先传小缩略图（失败不碍事，画廊会自动退化成占位图标），再传原图
      try {
        const thumb = await makeThumb(task.file);
        const thumbFile = new File([thumb], "t.webp", { type: "image/webp" });
        await uploadBlob(`b/${batch.batchId}/t/${task.seq}.webp`, thumbFile, task.id);
      } catch {
        /* 缩略图失败就算了 */
      }
      const safe = task.file.name.replace(/[\\/\r\n]/g, "_");
      await uploadBlob(
        `b/${batch.batchId}/f/${task.seq}-${encodeURIComponent(safe)}`,
        task.file,
        task.id
      );
      update(task.id, { status: "完成", progress: 100 });
      return true;
    } catch (e) {
      update(task.id, {
        status: "失败",
        error: e instanceof Error ? e.message : "上传失败",
      });
      return false;
    }
  }

  // 同时传 2 张，带宽和稳定性平衡一下
  async function runQueue(batch: BatchInfo, list: Task[]) {
    let idx = 0;
    let ok = 0;
    let fail = 0;
    const workers = Array.from({ length: 2 }, async () => {
      while (idx < list.length) {
        const task = list[idx++];
        (await uploadTask(batch, task)) ? ok++ : fail++;
      }
    });
    await Promise.all(workers);
    setNote(
      fail
        ? `上传结束：成功 ${ok} 张，失败 ${fail} 张（失败的可重新选择再传一次）`
        : `全部上传完成 ✔ 把取件码 ${batch.code} 发给客人即可`
    );
  }

  function onPickFiles(fileList: FileList | File[]) {
    if (!selected || !batchReady) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setNote("没有检测到图片文件");
      return;
    }
    const fresh: Task[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      seq: nextSeq.current++,
      status: "等待中" as const,
      progress: 0,
    }));
    setTasks((ts) => [...ts, ...fresh]);
    setNote("正在上传，请保持页面打开…");
    void runQueue(selected, fresh);
  }

  async function removeBatch(b: BatchInfo) {
    if (!confirm(`确定删除相册「${b.name}」？取件码 ${b.code} 立即失效，照片全部清除。`)) return;
    await fetch(`/api/admin/batches?batchId=${b.batchId}`, { method: "DELETE" });
    setBatches((bs) => bs.filter((x) => x.batchId !== b.batchId));
    if (selected?.batchId === b.batchId) {
      setSelected(null);
      setTasks([]);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`已复制：${text}`);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setNote(`已复制：${text}`);
    }
  }

  /* ---------- 视图 ---------- */
  if (authed === null) {
    return (
      <main className="wrap">
        <p className="muted">加载中…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="hero">
        <div className="hero-card">
          <div className="hero-logo">🔐</div>
          <h1>管理端登录</h1>
          <p className="muted">仅摄影师使用</p>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            placeholder="管理密码"
            autoFocus
          />
          <button className="btn btn-primary btn-block" onClick={doLogin}>
            登录
          </button>
          {loginError && <p className="error-text">{loginError}</p>}
          <p className="tiny muted">
            <a href="/">← 返回取件页</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="topbar">
        <h1>📷 照片交付 · 管理端</h1>
        <button className="btn btn-ghost btn-sm" onClick={doLogout}>
          退出登录
        </button>
      </header>

      {note && <p className="note">{note}</p>}

      <div className="grid-admin">
        {/* 左：相册列表 */}
        <section className="panel">
          <h2 className="panel-title">相册</h2>
          <div className="row new-batch">
            <input
              className="input"
              placeholder="相册名，如：小王的全家福"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createBatch()}
            />
            <select
              className="select"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} 天后过期
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={createBatch} disabled={creating}>
              {creating ? "创建中…" : "新建相册"}
            </button>
          </div>

          <div className="batch-list">
            {batches.length === 0 && <p className="muted">还没有相册，先新建一个。</p>}
            {batches.map((b) => (
              <div
                key={b.batchId}
                className={`batch-card${selected?.batchId === b.batchId ? " active" : ""}${
                  b.expired ? " expired" : ""
                }`}
              >
                <div className="row spread">
                  <strong>{b.name}</strong>
                  {b.expired ? (
                    <span className="badge">已过期</span>
                  ) : (
                    <span className="muted tiny">{daysLeft(b.expiresAt)} 天后过期</span>
                  )}
                </div>
                <div className="row spread">
                  <span className="code-chip">{b.code}</span>
                  <span className="row">
                    <button className="btn btn-ghost btn-sm" onClick={() => copyText(b.code)}>
                      复制码
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => selectBatch(b)}>
                      上传
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeBatch(b)}>
                      删除
                    </button>
                  </span>
                </div>
                <p className="tiny muted">
                  创建于 {fmtDate(b.createdAt)} · 客人在首页输入 {b.code} 取片
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 右：上传面板 */}
        <section className="panel">
          <h2 className="panel-title">上传照片</h2>
          {!selected ? (
            <p className="muted">← 先在左边选择或新建一个相册</p>
          ) : (
            <>
              <p className="muted">
                当前相册：<strong>{selected.name}</strong>
                {batchReady ? " · 可以开始上传" : " · 正在读取已有照片…"}
              </p>
              <div
                className="dropzone"
                onClick={() => batchReady && fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (batchReady) onPickFiles(e.dataTransfer.files);
                }}
              >
                <p>
                  <strong>拖拽照片到这里</strong>
                </p>
                <p className="muted tiny">或点击选择 · 自动生成缩略图 · 原图不压缩直传</p>
                <div className="row center">
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!batchReady}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInput.current?.click();
                    }}
                  >
                    选择文件
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!batchReady}
                    onClick={(e) => {
                      e.stopPropagation();
                      dirInput.current?.click();
                    }}
                  >
                    选择整个文件夹
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    if (e.target.files) onPickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={dirInput}
                  type="file"
                  multiple
                  hidden
                  {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
                  onChange={(e) => {
                    if (e.target.files) onPickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {tasks.length > 0 && (
                <div className="task-list">
                  {tasks.map((t) => (
                    <div key={t.id} className="task">
                      <div className="row spread">
                        <span className="task-name">{t.file.name}</span>
                        <span
                          className={
                            "st " +
                            (t.status === "完成"
                              ? "st-ok"
                              : t.status === "失败"
                                ? "st-fail"
                                : "st-busy")
                          }
                        >
                          {t.status === "上传中" ? `${t.progress}%` : t.status}
                        </span>
                      </div>
                      <div className="bar">
                        <div
                          className="bar-fill"
                          style={{ width: `${t.status === "完成" ? 100 : t.progress}%` }}
                        />
                      </div>
                      {t.error && <p className="tiny error-text">{t.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
