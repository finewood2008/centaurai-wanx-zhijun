import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  plugins: [react()],
  define: { BASE_URL: JSON.stringify("") },
  resolve: {
    alias: { "@": path.resolve(__dirname, "../dashboard/src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: { maxParallelFileOps: 3 },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
