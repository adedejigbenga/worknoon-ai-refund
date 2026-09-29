import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies /api to the backend, so the browser never needs the API origin or any secret.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4000" },
  },
});
