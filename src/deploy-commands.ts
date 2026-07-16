import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
await rest.put(
  Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
  { body: commands.map(command => command.toJSON()) }
);
console.log(`Registrati ${commands.length} comandi slash nel server.`);
