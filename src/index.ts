import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { handleCommand } from "./commands/index.js";
import { database } from "./database.js";
import { handleTicketButton, handleTicketModal, handleTicketSelect } from "./tickets.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, readyClient => console.log(`Nebula Bot online come ${readyClient.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) return void await handleCommand(interaction);
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("ticket:")) return void await handleTicketSelect(interaction);
    if (interaction.isButton() && interaction.customId.startsWith("ticket:")) return void await handleTicketButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket:")) return void await handleTicketModal(interaction);
  } catch (error) {
    console.error(error);
    if (!interaction.isRepliable()) return;
    const message = { content: "Si è verificato un errore. Controlla i permessi del bot e riprova.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(message).catch(console.error);
    else await interaction.reply(message).catch(console.error);
  }
});

process.on("SIGINT", () => { database.close(); client.destroy(); process.exit(0); });
await client.login(config.DISCORD_TOKEN);
