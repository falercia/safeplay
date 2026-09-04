import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@risk": path.resolve(__dirname, "supabase/functions/_shared/risk"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
