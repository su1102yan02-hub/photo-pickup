import { NextResponse } from "next/server";
import { login } from "@/lib/auth";

// 管理端登录：校验密码，成功后由 lib/auth 种下签名 Cookie
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!body.password || !(await login(body.password))) {
    return NextResponse.json({ error: "密码不对" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
