import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    // Real-browser tests are slower and need Chrome: npm run test:browser
    exclude: ["src/**/*.browser.test.ts", "node_modules/**"],
    environment: "node",
  },
});
