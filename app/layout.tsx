import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "照片取件 · 原画质交付",
  description: "输入取件码，下载无压缩的摄影原片",
};

// 手机浏览器顶栏颜色跟随浅色主题
export const viewport: Viewport = {
  themeColor: "#f7f5f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
