import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Produces a minimal standalone server in `.next/standalone/` for the
  // Docker image. Keeps the final image lean.
  output: "standalone",
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
