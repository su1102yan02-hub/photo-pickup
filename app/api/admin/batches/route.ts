import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { codeDisplay, generateCode } from "@/lib/codes";
import {
  deleteBatch,
  generateBatchId,
  isExpired,
  listBatches,
  putBatchMeta,
  type BatchMeta,
} from "@/lib/blob";

// 没配存储时给出明确提示，而不是莫名的 500
// 线上：连接 Blob 存储后会自动注入 BLOB_STORE_ID（SDK 自动鉴权）
// 本地：.env.local 里放 BLOB_READ_WRITE_TOKEN
function missingToken() {
  return (
    !process.env.BLOB_STORE_ID &&
    !process.env.BLOB_READ_WRITE_TOKEN &&
    NextResponse.json(
      { error: "缺少存储配置：线上在 Vercel Storage 连接项目后重新部署，本地放 .env.local" },
      { status: 500 }
    )
  );
}

// 线上意外报错时把真实原因带回页面显示，避免前端只看到空 500
function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: `服务端错误：${message}` }, { status: 500 });
}

// 列出全部相册（含已过期的，方便手动删除释放空间）
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const err = missingToken();
  if (err) return err;
  try {
    const metas = await listBatches();
    return NextResponse.json({
      batches: metas.map((m) => ({
        batchId: m.batchId,
        codeKey: m.codeKey,
        code: codeDisplay(m.codeKey),
        name: m.name,
        createdAt: m.createdAt,
        expiresAt: m.expiresAt,
        expired: isExpired(m),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

// 新建相册：生成 8 位取件码 + 随机 batchId，把元数据写进 meta.json
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const err = missingToken();
  if (err) return err;
  const body = (await request.json().catch(() => ({}))) as { name?: string; days?: number };
  const name = (body.name ?? "").toString().trim().slice(0, 60) || "未命名相册";
  const days = Math.min(30, Math.max(1, Number(body.days) || 7));

  try {
    // 取件码撞车概率约等于零，但还是查一下已有相册
    const existing = await listBatches();
    let codeKey = generateCode();
    for (let i = 0; i < 10 && existing.some((m) => m.codeKey === codeKey); i++) {
      codeKey = generateCode();
    }

    const now = Date.now();
    const meta: BatchMeta = {
      batchId: generateBatchId(),
      codeKey,
      name,
      createdAt: now,
      expiresAt: now + days * 86400000,
    };
    await putBatchMeta(meta);
    return NextResponse.json({
      ok: true,
      batch: { ...meta, code: codeDisplay(codeKey), expired: false },
    });
  } catch (e) {
    return serverError(e);
  }
}

// 删除整个相册（元数据 + 原图 + 缩略图）
export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const err = missingToken();
  if (err) return err;
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (!/^[a-z0-9]{12}$/.test(batchId)) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }
  try {
    await deleteBatch(batchId);
  } catch (e) {
    return serverError(e);
  }
  return NextResponse.json({ ok: true });
}
