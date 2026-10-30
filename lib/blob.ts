// 相册元数据的存取。不引入数据库：
// 每个相册在 Blob 里存一个小 JSON（b/{batchId}/meta.json），
// 文件靠前缀列举（b/{batchId}/f/... 和 t/...）发现。
// batchId 是随机的，外人拿到链接也无法枚举其他相册。
import { randomUUID } from "crypto";
import { del, list, put } from "@vercel/blob";

export type BatchMeta = {
  batchId: string;
  codeKey: string; // 8 位大写无横线取件码
  name: string; // 相册名（如“张小姐的婚纱照”）
  createdAt: number;
  expiresAt: number; // 到期时间戳，过期后客人不可见
};

export function generateBatchId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function isExpired(meta: BatchMeta): boolean {
  return Date.now() > meta.expiresAt;
}

/** 写入/覆盖相册元数据（addRandomSuffix 必须关掉，路径才可预测） */
export async function putBatchMeta(meta: BatchMeta): Promise<void> {
  await put(`b/${meta.batchId}/meta.json`, JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

/** 列出所有相册的元数据（相册数量少，逐个读 meta.json 没问题） */
export async function listBatches(): Promise<BatchMeta[]> {
  const metas: BatchMeta[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: "b/", cursor });
    for (const blob of res.blobs) {
      if (!blob.pathname.endsWith("/meta.json")) continue;
      try {
        const r = await fetch(blob.url, { cache: "no-store" });
        metas.push(JSON.parse(await r.text()) as BatchMeta);
      } catch {
        // 某个 meta 损坏就跳过，不影响其他相册
      }
    }
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  metas.sort((a, b) => b.createdAt - a.createdAt);
  return metas;
}

/** 删除整个相册（元数据 + 原图 + 缩略图） */
export async function deleteBatch(batchId: string): Promise<void> {
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await list({ prefix: `b/${batchId}/`, cursor });
    urls.push(...res.blobs.map((b) => b.url));
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
  // del 一次最多删一批，分片删
  for (let i = 0; i < urls.length; i += 500) {
    await del(urls.slice(i, i + 500));
  }
}
