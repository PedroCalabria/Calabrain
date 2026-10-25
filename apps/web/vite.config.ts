import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // .env lives at the repo root, shared with the API.
  envDir: "../..",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
});
