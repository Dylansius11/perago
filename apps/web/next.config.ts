import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * The workspace root, so file tracing follows pnpm's symlinked `@perago/sdk`
 * instead of guessing a root from `apps/web`.
 */
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  typedRoutes: true,
};

export default nextConfig;
