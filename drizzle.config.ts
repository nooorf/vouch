import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Locally the URLs live in .env.local; on Vercel they are real env vars.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL (Neon direct, non-pooled connection string)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
