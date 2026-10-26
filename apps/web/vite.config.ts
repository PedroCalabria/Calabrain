import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // .env lives at the repo root, shared with the API.
  envDir: "../..",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    rolldownOptions: {
      output: {
        // pdf.js ships its worker as .mjs, and many static servers (nginx included) send .mjs
        // as a download, which the browser refuses to run. Emit it as .js so any host serves it right.
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith(".mjs")) ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]",
      },
    },
  },
});
