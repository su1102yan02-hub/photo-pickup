import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { isExpired, listBatches } from "@/lib/blob";
import { normalizeCode } from "@/lib/codes";

type FileEntry = {
  seq: number;
  name: string;
  size: number;
  url: string;
  thumb?: string;
};

// 客人取件：输入取件码 → 校验 → 返回文件列表（原图直链 + 缩略图直链）
// 之后浏览器直接从 Blob 下载，不经服务器，速度和画质都不打折。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const codeKey = normalizeCode(decodeURIComponent(code ?? ""));
  if (codeKey.length !== 8) {
    return NextResponse.json({ error: "取件码是 8 位字母数字" }, { status: 400 });
  }
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "服务端缺少存储配置：请先在 Vercel Storage 创建 Blob 并连接到本项目，然后重新部署" },
      { status: 500 }
    );
  }

  const meta = (await listBatches()).find((m) => m.codeKey === codeKey);
  if (!meta || isExpired(meta)) {
    return NextResponse.json({ error: "取件码不存在或已过期" }, { status: 404 });
  }

  // 缩略图：b/{batchId}/t/{序号}.webp → 按序号建索引
  const thumbs = new Map<number, string>();
  for (const blob of (await list({ prefix: `b/${meta.batchId}/t/` })).blobs) {
    const m = blob.pathname.match(/\/t\/(\d+)\.webp$/);
    if (m) thumbs.set(Number(m[1]), blob.url);
  }

  // 原图：b/{batchId}/f/{序号}-{URL编码的文件名}
  const files: FileEntry[] = [];
  for (const blob of (await list({ prefix: `b/${meta.batchId}/f/` })).blobs) {
    const m = blob.pathname.match(/\/f\/(\d+)-(.+)$/);
    if (!m) continue;
    let name = m[2];
    try {
      name = decodeURIComponent(name);
    } catch {
      // 文件名编码异常就用原始串，不影响下载
    }
    files.push({
      seq: Number(m[1]),
      name,
      size: blob.size,
      url: blob.url,
      thumb: thumbs.get(Number(m[1])),
    });
  }
  files.sort((a, b) => a.seq - b.seq);

  return NextResponse.json(
    { name: meta.name, expiresAt: meta.expiresAt, files },
    { headers: { "cache-control": "no-store" } }
  );
}
