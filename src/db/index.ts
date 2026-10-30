import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function connectionString() {
  // The app uses Neon's pooled endpoint; migrations use the direct one (drizzle.config.ts).
  const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL_POOLED (or DATABASE_URL)");
  return url;
}

function create() {
  const client = postgres(connectionString(), {
    // Neon's pooler runs PgBouncer in transaction mode, which does not support prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return { client, db: drizzle(client, { schema, casing: "snake_case" }) };
}

// Reuse one pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __vouchDb?: ReturnType<typeof create> };

function instance() {
  globalForDb.__vouchDb ??= create();
  return globalForDb.__vouchDb;
}

/** Lazily connected, so importing this module never needs env vars (e.g. during `next build`). */
export const db = new Proxy({} as ReturnType<typeof create>["db"], {
  get: (_target, prop) => Reflect.get(instance().db, prop),
});

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function closeDb() {
  await globalForDb.__vouchDb?.client.end();
  globalForDb.__vouchDb = undefined;
}

export { schema };
