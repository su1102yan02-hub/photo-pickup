import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "照片取件 · 原画质交付",
  description: "输入取件码，下载无压缩的摄影原片",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
