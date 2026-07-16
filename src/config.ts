import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN mancante nel file .env"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID mancante nel file .env"),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID mancante nel file .env"),
  DATABASE_PATH: z.string().default("./data/nebula.db")
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error("Configurazione non valida:");
  for (const issue of result.error.issues) console.error(`- ${issue.message}`);
  process.exit(1);
}

export const config = result.data;
