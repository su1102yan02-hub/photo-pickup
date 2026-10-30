// 取件码的生成与规范化（纯函数，客户端/服务端都能用）

// 去掉容易混淆的字符：0/O、1/I/l，剩下 31 个字符
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 生成 8 位取件码（不含横线），如 "7K2MA9DX" */
export function generateCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

/** 把用户输入统一成 8 位大写无横线形式（大小写、横线、空格都能容忍） */
export function normalizeCode(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "7K2MA9DX" -> "7K2M-A9DX"（仅用于展示） */
export function codeDisplay(codeKey: string): string {
  return codeKey.slice(0, 4) + "-" + codeKey.slice(4);
}
