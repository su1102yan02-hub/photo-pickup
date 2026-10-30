import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isAdmin } from "@/lib/auth";

// 允许的存储路径：b/{batchId}/f/{序号}-{文件名}（原图）或 b/{batchId}/t/{序号}.webp（缩略图）
const OK_PATH = /^b\/[a-z0-9]{12}\/(f\/\d{1,6}-.+|t\/\d{1,6}\.webp)$/;

// 浏览器直传的"门票"接口：
// 照片文件不经过本服务器，浏览器拿着这里签发的 token 直接传到 Vercel Blob，
// 所以不受 Vercel 4.5MB 请求体限制，原图多大都行。
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return new Response("未登录或登录已过期", { status: 401 });
  }
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // 签发上传凭证前校验：只允许写进指定格式路径，且只允许图片
      onBeforeGenerateToken: async (pathname) => {
        if (!OK_PATH.test(pathname)) {
          throw new Error("不允许的存储路径");
        }
        return {
          allowedContentTypes: ["image/*"],
          maximumSizeInBytes: 500 * 1024 * 1024, // 单张上限 500MB，摄影原片足够
        };
      },
      // 我们不用数据库（文件靠前缀列举发现），上传完成的回调留空即可
      onUploadCompleted: async () => {},
    });
    return Response.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "签发上传凭证失败";
    return new Response(message, { status: 400 });
  }
}
