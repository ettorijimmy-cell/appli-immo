import { defineConfig } from "drizzle-kit";
import { DEFAULT_DEV_DATABASE_URL } from "./src/client";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL
  }
});
