import { deleteBatch, isExpired, listBatches } from "@/lib/blob";

// 每天跑一次的清理任务（见 vercel.json 的 cron，UTC 19 点 = 北京时间凌晨 3 点），
// 把已过期的相册连同照片整个删掉，保证免费额度不被占满。
// Vercel 定时任务会自动带上 Authorization: Bearer <CRON_SECRET> 请求头。
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const batches = await listBatches();
  let deleted = 0;
  for (const meta of batches) {
    if (isExpired(meta)) {
      await deleteBatch(meta.batchId);
      deleted++;
    }
  }
  return Response.json({ ok: true, deletedBatches: deleted });
}
