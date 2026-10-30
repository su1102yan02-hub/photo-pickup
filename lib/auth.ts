// 管理端登录态：密码存在 Vercel 环境变量 ADMIN_PASSWORD 里，
// 登录成功后下发一个由密码派生的 HMAC 签名 Cookie（HttpOnly）。
// 改密码 = 旧 Cookie 全部失效。
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "pp_admin";

function expectedToken(): string {
  const secret = process.env.ADMIN_PASSWORD ?? "";
  return createHmac("sha256", secret).update("photo-pickup-admin-v1").digest("hex");
}

/** 当前请求是否已登录（供各个管理接口调用） */
export async function isAdmin(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false;
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value ?? "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expectedToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 尝试用密码登录，成功则种下 Cookie */
export async function login(password: string): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) return false;
  const jar = await cookies();
  jar.set(COOKIE_NAME, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 天免登录
  });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
