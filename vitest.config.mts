import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.local" });

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["lib/**/*.test.ts"],
    // Database tests share one test database, so run files one at a time.
    fileParallelism: false,
  },
});
