import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the fully-static `out/` bundle that ships inside the
// Android APK (Capacitor). In that build the API routes are excluded by the
// build script and the app runs 100% client-side (localStorage persistence).
const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isStatic ? "export" : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
