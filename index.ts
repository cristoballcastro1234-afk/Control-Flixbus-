import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

export const database = drizzle({ schema });
