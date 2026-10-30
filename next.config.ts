import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 不装 ESLint 依赖也能正常构建
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
