import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "栈知映 · 以 AI 光影，筑程序学习之路",
  description: "从知识搜索出发，生成可观看的 AI 视频课堂。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
