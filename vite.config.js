import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      input: { game: "index.html", admin: "admin/index.html" },
      output: { manualChunks: { three: ["three"] } },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
