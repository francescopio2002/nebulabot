import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel
} from "discord.js";
import { createWarning, getWarnings, saveTicketConfig, type TicketSection } from "../database.js";

export const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Controlla la latenza del bot"),
  new SlashCommandBuilder().setName("help").setDescription("Mostra i comandi disponibili"),
  new SlashCommandBuilder()
    .setName("kick").setDescription("Espelle un utente")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("utente").setDescription("Utente da espellere").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo")),
  new SlashCommandBuilder()
    .setName("ban").setDescription("Banna un utente")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("utente").setDescription("Utente da bannare").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo")),
  new SlashCommandBuilder()
    .setName("purge").setDescription("Elimina messaggi recenti")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName("quantita").setDescription("Da 1 a 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder()
    .setName("warn").setDescription("Assegna un avvertimento")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("utente").setDescription("Utente").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(true)),
  new SlashCommandBuilder()
    .setName("warnings").setDescription("Mostra gli avvertimenti di un utente")
    .addUserOption(o => o.setName("utente").setDescription("Utente").setRequired(true)),
  new SlashCommandBuilder()
    .setName("ticket").setDescription("Configura il sistema ticket")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName("setup")
      .setDescription("Crea un unico pannello ticket con tutte le sezioni")
      .addChannelOption(o => o
        .setName("canale_pannello")
        .setDescription("Canale dove pubblicare il pannello ticket")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addChannelOption(o => o
        .setName("categoria_generale")
        .setDescription("Categoria dei ticket di assistenza generale")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addChannelOption(o => o
        .setName("categoria_donazioni")
        .setDescription("Categoria dei ticket donazioni")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addChannelOption(o => o
        .setName("categoria_partnership")
        .setDescription("Categoria dei ticket partnership")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addChannelOption(o => o
        .setName("categoria_segnalazioni")
        .setDescription("Categoria dei ticket segnalazioni")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true))
      .addRoleOption(o => o
        .setName("staff")
        .setDescription("Ruolo che può visualizzare e gestire i ticket")
        .setRequired(true))
      .addChannelOption(o => o
        .setName("log")
        .setDescription("Canale dei log ticket")
        .addChannelTypes(ChannelType.GuildText)))
];

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return interaction.reply({ content: "Comando disponibile solo nei server.", flags: MessageFlags.Ephemeral });

  switch (interaction.commandName) {
    case "ping":
      return interaction.reply(`Pong! ${interaction.client.ws.ping} ms`);
    case "help":
      return interaction.reply({ content: "Comandi: /ping, /help, /kick, /ban, /purge, /warn, /warnings, /ticket setup", flags: MessageFlags.Ephemeral });
    case "kick": {
      const member = interaction.options.getMember("utente");
      const reason = interaction.options.getString("motivo") ?? "Nessun motivo specificato";
      if (!member || !("kick" in member)) return interaction.reply({ content: "Utente non valido.", flags: MessageFlags.Ephemeral });
      await member.kick(reason);
      return interaction.reply(`Utente espulso. Motivo: ${reason}`);
    }
    case "ban": {
      const user = interaction.options.getUser("utente", true);
      const reason = interaction.options.getString("motivo") ?? "Nessun motivo specificato";
      await interaction.guild.members.ban(user.id, { reason });
      return interaction.reply(`Utente bannato. Motivo: ${reason}`);
    }
    case "purge": {
      const amount = interaction.options.getInteger("quantita", true);
      if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
        return interaction.reply({ content: "Questo comando funziona solo in un canale testuale del server.", flags: MessageFlags.Ephemeral });
      }
      const deleted = await (interaction.channel as TextChannel).bulkDelete(amount, true);
      return interaction.reply({ content: `${deleted.size} messaggi eliminati.`, flags: MessageFlags.Ephemeral });
    }
    case "warn": {
      const user = interaction.options.getUser("utente", true);
      const reason = interaction.options.getString("motivo", true);
      createWarning(interaction.guild.id, user.id, interaction.user.id, reason);
      return interaction.reply(`${user} ha ricevuto un avvertimento: ${reason}`);
    }
    case "warnings": {
      const user = interaction.options.getUser("utente", true);
      const warnings = getWarnings(interaction.guild.id, user.id);
      if (!warnings.length) return interaction.reply({ content: `${user.tag} non ha avvertimenti.`, flags: MessageFlags.Ephemeral });
      const text = warnings.map((w, i) => `${i + 1}. ${w.reason} — <@${w.moderatorId}>`).join("\n");
      return interaction.reply({ content: `Avvertimenti di ${user.tag}:\n${text}`, flags: MessageFlags.Ephemeral });
    }
    case "ticket": {
      const panelChannel = interaction.options.getChannel("canale_pannello", true);
      const staffRole = interaction.options.getRole("staff", true);
      const logChannel = interaction.options.getChannel("log");

      if (panelChannel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: "Il canale del pannello deve essere un canale testuale.", flags: MessageFlags.Ephemeral });
      }

      const categories: Record<TicketSection, string> = {
        generale: interaction.options.getChannel("categoria_generale", true).id,
        donazioni: interaction.options.getChannel("categoria_donazioni", true).id,
        partnership: interaction.options.getChannel("categoria_partnership", true).id,
        segnalazioni: interaction.options.getChannel("categoria_segnalazioni", true).id
      };

      for (const [section, categoryId] of Object.entries(categories) as [TicketSection, string][]) {
        saveTicketConfig({
          guildId: interaction.guild.id,
          section,
          categoryId,
          panelChannelId: panelChannel.id,
          staffRoleId: staffRole.id,
          logChannelId: logChannel?.id ?? null
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x6d5dfc)
        .setTitle("🎟️ Sistema Ticket")
        .setDescription(
          "Apri un ticket scegliendo la categoria più adatta alla tua richiesta.\n" +
          "Il nostro staff ti risponderà il prima possibile!\n\n" +
          "🛡️ **Usa il menu a tendina qui sotto per creare un canale privato con lo staff.**\n\n" +
          "💬 **Assistenza Generale** — Domande, problemi o richieste generali.\n" +
          "💎 **Donazioni** — Pagamenti, donazioni o vantaggi collegati.\n" +
          "🤝 **Partnership** — Collaborazioni, sponsor o partnership.\n" +
          "🚩 **Segnalazioni** — Segnala un utente o un problema al server."
        )
        .setImage("attachment://ticket-banner.png")
        .setFooter({ text: "Nebula Bot • Il nostro staff è al tuo servizio!" });

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ticket:create")
          .setPlaceholder("Seleziona il tipo di ticket...")
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            { label: "Assistenza Generale", value: "generale", emoji: "💬", description: "Domande, problemi o richieste generali" },
            { label: "Donazioni", value: "donazioni", emoji: "💎", description: "Pagamenti, donazioni e vantaggi" },
            { label: "Partnership", value: "partnership", emoji: "🤝", description: "Collaborazioni, sponsor e partnership" },
            { label: "Segnalazioni", value: "segnalazioni", emoji: "🚩", description: "Segnala utenti o problemi al server" }
          )
      );

      await (panelChannel as TextChannel).send({
        embeds: [embed],
        components: [row],
        files: [{ attachment: "assets/ticket-banner.png", name: "ticket-banner.png" }]
      });

      return interaction.reply({
        content: `Pannello ticket unico pubblicato in ${panelChannel}. Tutte le sezioni sono state configurate.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
}
