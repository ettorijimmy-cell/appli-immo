import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Postgres de dev local (docker-compose.yml à la racine) — port 5433 pour
// ne jamais entrer en conflit avec un Postgres déjà présent sur 5432.
export const DEFAULT_DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/appli_immo_dev";

export function createDbClient(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDbClient>;
