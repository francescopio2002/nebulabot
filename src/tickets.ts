import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type Message,
  type TextChannel
} from "discord.js";
import {
  claimTicket,
  createTicket,
  deleteTicket,
  getOpenTicketByOwner,
  getTicket,
  getTicketConfig,
  setTicketControlMessage,
  transferTicket,
  saveTicketFeedback,
  type TicketRecord,
  type TicketSection
} from "./database.js";

const sectionInfo: Record<TicketSection, { label: string; emoji: string; description: string }> = {
  generale: { label: "Assistenza Generale", emoji: "💬", description: "Descrivi la tua richiesta generale. Lo staff ti risponderà appena possibile." },
  donazioni: { label: "Donazioni", emoji: "💎", description: "Indica il metodo di donazione e il problema o la richiesta da gestire." },
  partnership: { label: "Partnership", emoji: "🤝", description: "Presenta il tuo server o progetto e specifica la proposta di collaborazione." },
  segnalazioni: { label: "Segnalazioni", emoji: "🚩", description: "Descrivi la segnalazione con prove e informazioni utili allo staff." }
};

function safeChannelName(section: TicketSection, username: string): string {
  const clean = username.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 45);
  return `${section}-${clean || "utente"}`;
}
function safeRename(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}
function isTicketSection(value: string): value is TicketSection { return value in sectionInfo; }
function formatTicketNumber(value: number): string { return `#${String(value).padStart(5, "0")}`; }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function controls(): ActionRowBuilder<ButtonBuilder>[] {
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket:claim").setLabel("Prendi in carico").setEmoji("🟢").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket:add-user").setLabel("Aggiungi utente").setEmoji("👥").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:remove-user").setLabel("Rimuovi utente").setEmoji("🚫").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:rename").setLabel("Rinomina").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:transfer").setLabel("Trasferisci").setEmoji("📦").setStyle(ButtonStyle.Primary)
  );
  const second = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket:transcript").setLabel("Transcript").setEmoji("📝").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket:request-feedback").setLabel("Feedback").setEmoji("⭐").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket:close").setLabel("Chiudi").setEmoji("🔒").setStyle(ButtonStyle.Danger)
  );
  return [first, second];
}

function ticketEmbed(ticket: TicketRecord): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x6d5dfc)
    .setTitle(`🎫 Ticket ${formatTicketNumber(ticket.ticketNumber)}`)
    .setDescription(sectionInfo[ticket.section].description)
    .addFields(
      { name: "👤 Creato da", value: `<@${ticket.ownerId}>`, inline: true },
      { name: "📂 Categoria", value: sectionInfo[ticket.section].label, inline: true },
      { name: "👮 Staff", value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Nessuno", inline: true }
    )
    .setFooter({ text: "Nebula Bot • Sistema Ticket" })
    .setTimestamp(new Date(ticket.createdAt));
}


function feedbackControls(guildId: string, ticketNumber: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let rating = 1; rating <= 5; rating += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:feedback:${guildId}:${ticketNumber}:${rating}`)
        .setLabel(`${rating}`)
        .setEmoji("⭐")
        .setStyle(rating === 5 ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }
  return row;
}

async function requestFeedback(channel: TextChannel, ticket: TicketRecord): Promise<boolean> {
  try {
    const owner = await channel.client.users.fetch(ticket.ownerId);
    await owner.send({
      content: `⭐ **Valuta il supporto ricevuto**\nTicket **${formatTicketNumber(ticket.ticketNumber)}** nel server **${channel.guild.name}**.`,
      components: [feedbackControls(ticket.guildId, ticket.ticketNumber)]
    });
    return true;
  } catch (error) {
    console.warn("Impossibile inviare la richiesta di feedback in DM:", error);
    return false;
  }
}

async function isStaffMember(member: GuildMember, ticket: TicketRecord): Promise<boolean> {
  const settings = getTicketConfig(ticket.guildId, ticket.section);
  return Boolean((settings?.staffRoleId && member.roles.cache.has(settings.staffRoleId)) || member.permissions.has(PermissionFlagsBits.ManageChannels));
}

async function updateControlMessage(channel: TextChannel, ticket: TicketRecord): Promise<void> {
  if (!ticket.controlMessageId) return;
  const message = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
  if (message) await message.edit({ embeds: [ticketEmbed(ticket)], components: controls() });
}

async function fetchAllMessages(channel: TextChannel): Promise<Message[]> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function createTranscript(channel: TextChannel, ticket: TicketRecord): Promise<AttachmentBuilder> {
  const messages = await fetchAllMessages(channel);
  const rows = messages.map(message => {
    const attachments = [...message.attachments.values()].map(file => `<div class="attachment"><a href="${escapeHtml(file.url)}">📎 ${escapeHtml(file.name ?? "allegato")}</a></div>`).join("");
    const content = message.content ? escapeHtml(message.content).replaceAll("\n", "<br>") : "<em>Nessun testo</em>";
    return `<article class="message"><img class="avatar" src="${escapeHtml(message.author.displayAvatarURL({ extension: "png", size: 64 }))}" alt="avatar"><div class="body"><div class="meta"><strong>${escapeHtml(message.author.tag)}</strong><span>${message.createdAt.toLocaleString("it-IT")}</span></div><div class="content">${content}</div>${attachments}</div></article>`;
  }).join("\n");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transcript ${escapeHtml(channel.name)}</title><style>body{margin:0;background:#0b0d14;color:#e6e8ef;font-family:Arial,sans-serif}.wrap{max-width:980px;margin:0 auto;padding:32px}.head{background:linear-gradient(135deg,#5b21b6,#2563eb);padding:24px;border-radius:16px;margin-bottom:22px}.head h1{margin:0 0 8px}.head p{margin:4px 0;opacity:.9}.message{display:flex;gap:14px;padding:16px;border-bottom:1px solid #252938;background:#111522}.avatar{width:42px;height:42px;border-radius:50%}.body{min-width:0;flex:1}.meta{display:flex;gap:10px;align-items:baseline}.meta span{font-size:12px;color:#9ca3af}.content{margin-top:6px;line-height:1.5;word-break:break-word}.attachment{margin-top:8px}.attachment a{color:#60a5fa;text-decoration:none}.footer{margin-top:20px;color:#9ca3af;font-size:13px}</style></head><body><main class="wrap"><header class="head"><h1>🌌 Nebula Bot — Transcript ${formatTicketNumber(ticket.ticketNumber)}</h1><p>Canale: #${escapeHtml(channel.name)}</p><p>Categoria: ${escapeHtml(sectionInfo[ticket.section].label)}</p><p>Proprietario: ${escapeHtml(ticket.ownerId)}</p><p>Staff: ${escapeHtml(ticket.claimedBy ?? "Nessuno")}</p><p>Messaggi: ${messages.length}</p></header>${rows || "<p>Nessun messaggio presente.</p>"}<div class="footer">Transcript generato automaticamente da Nebula Bot.</div></main></body></html>`;
  return new AttachmentBuilder(Buffer.from(html, "utf8"), { name: `transcript-${formatTicketNumber(ticket.ticketNumber).slice(1)}-${Date.now()}.html` });
}

async function sendTranscript(channel: TextChannel, ticket: TicketRecord, closedByTag?: string): Promise<{ dmSent: boolean; logSent: boolean }> {
  const settings = getTicketConfig(ticket.guildId, ticket.section);
  const transcript = await createTranscript(channel, ticket);
  const data = transcript.attachment;
  const name = transcript.name ?? `transcript-${channel.name}.html`;
  let dmSent = false;
  try {
    const owner = await channel.client.users.fetch(ticket.ownerId);
    await owner.send({ content: `📄 Transcript del ticket **${formatTicketNumber(ticket.ticketNumber)}** (${sectionInfo[ticket.section].label}) nel server **${channel.guild.name}**.`, files: [new AttachmentBuilder(data, { name })] });
    dmSent = true;
  } catch (error) { console.warn("Impossibile inviare il transcript in DM:", error); }
  let logSent = false;
  if (settings?.logChannelId) {
    const log = channel.guild.channels.cache.get(settings.logChannelId);
    if (log?.isTextBased()) {
      await log.send({ content: `${closedByTag ? "🔒" : "📝"} Transcript ticket **${formatTicketNumber(ticket.ticketNumber)}** (${sectionInfo[ticket.section].label})${closedByTag ? ` chiuso da ${closedByTag}` : " generato manualmente"}.\n📨 DM: ${dmSent ? "inviato" : "non inviato"}`, files: [new AttachmentBuilder(data, { name })] });
      logSent = true;
    }
  }
  return { dmSent, logSent };
}

export async function handleTicketSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (interaction.customId === "ticket:create") {
    const section = interaction.values[0];
    if (!section || !isTicketSection(section)) return void await interaction.reply({ content: "Sezione ticket non valida.", flags: MessageFlags.Ephemeral });
    const settings = getTicketConfig(interaction.guild.id, section);
    if (!settings) return void await interaction.reply({ content: `La sezione ${sectionInfo[section].label} non è configurata.`, flags: MessageFlags.Ephemeral });
    const existing = getOpenTicketByOwner(interaction.guild.id, interaction.user.id, section);
    if (existing) return void await interaction.reply({ content: `Hai già un ticket aperto: <#${existing.channelId}>`, flags: MessageFlags.Ephemeral });

    const permissionOverwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
    ];
    if (settings.staffRoleId) permissionOverwrites.push({ id: settings.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] });

    const channel = await interaction.guild.channels.create({ name: safeChannelName(section, interaction.user.username), type: ChannelType.GuildText, parent: settings.categoryId, topic: `${sectionInfo[section].label} di ${interaction.user.tag} | ${interaction.user.id}`, permissionOverwrites });
    const number = createTicket(channel.id, interaction.guild.id, interaction.user.id, section);
    const ticket = getTicket(channel.id);
    if (!ticket) throw new Error("Impossibile rileggere il ticket appena creato");
    const message = await channel.send({ content: settings.staffRoleId ? `${interaction.user} <@&${settings.staffRoleId}>` : `${interaction.user}`, embeds: [ticketEmbed(ticket)], components: controls() });
    setTicketControlMessage(channel.id, message.id);
    await interaction.reply({ content: `Ticket ${formatTicketNumber(number)} creato: ${channel}`, flags: MessageFlags.Ephemeral });
    if (settings.logChannelId) {
      const log = interaction.guild.channels.cache.get(settings.logChannelId);
      if (log?.isTextBased()) await log.send(`${sectionInfo[section].emoji} Ticket **${formatTicketNumber(number)}** ${channel} aperto da ${interaction.user.tag}.`);
    }
    return;
  }

  if (interaction.customId === "ticket:transfer-select") {
    const ticket = getTicket(interaction.channelId);
    if (!ticket) return void await interaction.reply({ content: "Questo canale non è un ticket.", flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!(await isStaffMember(member, ticket))) return void await interaction.reply({ content: "Solo lo staff può trasferire il ticket.", flags: MessageFlags.Ephemeral });
    const section = interaction.values[0];
    if (!section || !isTicketSection(section)) return void await interaction.reply({ content: "Categoria non valida.", flags: MessageFlags.Ephemeral });
    const destination = getTicketConfig(interaction.guild.id, section);
    if (!destination) return void await interaction.reply({ content: "La categoria scelta non è configurata.", flags: MessageFlags.Ephemeral });
    const channel = interaction.channel as TextChannel;
    await channel.setParent(destination.categoryId, { lockPermissions: false });
    await channel.setName(safeChannelName(section, channel.name.replace(/^[^-]+-/, "")));
    transferTicket(channel.id, section);
    const updated = getTicket(channel.id)!;
    await updateControlMessage(channel, updated);
    await interaction.update({ content: `📦 Ticket trasferito in **${sectionInfo[section].label}**.`, components: [] });
  }
}

function modal(customId: string, title: string, inputId: string, label: string, placeholder: string): ModalBuilder {
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(inputId).setLabel(label).setPlaceholder(placeholder).setRequired(true).setStyle(TextInputStyle.Short).setMaxLength(100)));
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith("ticket:")) return;

  if (interaction.customId.startsWith("ticket:feedback:")) {
    const [, , guildId, ticketNumberText, ratingText] = interaction.customId.split(":");
    const ticketNumber = Number(ticketNumberText);
    const rating = Number(ratingText);
    if (!guildId || !Number.isInteger(ticketNumber) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return void await interaction.reply({ content: "Valutazione non valida.", flags: MessageFlags.Ephemeral });
    }
    saveTicketFeedback(guildId, ticketNumber, interaction.user.id, rating);
    return void await interaction.update({
      content: `Grazie! Hai valutato il supporto con **${"⭐".repeat(rating)}** (${rating}/5).`,
      components: []
    });
  }

  if (!interaction.guild) return;
  if (!interaction.channelId) return void await interaction.reply({ content: "Interazione fuori da un canale ticket.", flags: MessageFlags.Ephemeral });
  const ticket = getTicket(interaction.channelId);
  if (!ticket) return void await interaction.reply({ content: "Questo canale non risulta essere un ticket.", flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const staff = await isStaffMember(member, ticket);
  const owner = interaction.user.id === ticket.ownerId;
  const channel = interaction.channel as TextChannel;

  switch (interaction.customId) {
    case "ticket:claim":
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può prendere in carico un ticket.", flags: MessageFlags.Ephemeral });
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) return void await interaction.reply({ content: `Il ticket è già gestito da <@${ticket.claimedBy}>.`, flags: MessageFlags.Ephemeral });
      claimTicket(ticket.channelId, interaction.user.id);
      await updateControlMessage(channel, getTicket(ticket.channelId)!);
      return void await interaction.reply(`🟢 ${interaction.user} ha preso in carico il ticket.`);
    case "ticket:add-user":
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può aggiungere utenti.", flags: MessageFlags.Ephemeral });
      return void await interaction.showModal(modal("ticket:add-user-modal", "Aggiungi utente", "user-id", "ID dell'utente", "123456789012345678"));
    case "ticket:remove-user":
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può rimuovere utenti.", flags: MessageFlags.Ephemeral });
      return void await interaction.showModal(modal("ticket:remove-user-modal", "Rimuovi utente", "user-id", "ID dell'utente", "123456789012345678"));
    case "ticket:rename":
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può rinominare il ticket.", flags: MessageFlags.Ephemeral });
      return void await interaction.showModal(modal("ticket:rename-modal", "Rinomina ticket", "channel-name", "Nuovo nome", "problema-pagamento"));
    case "ticket:transfer": {
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può trasferire il ticket.", flags: MessageFlags.Ephemeral });
      const menu = new StringSelectMenuBuilder().setCustomId("ticket:transfer-select").setPlaceholder("Scegli la nuova categoria").addOptions(
        { label: "Assistenza Generale", value: "generale", emoji: "💬" }, { label: "Donazioni", value: "donazioni", emoji: "💎" },
        { label: "Partnership", value: "partnership", emoji: "🤝" }, { label: "Segnalazioni", value: "segnalazioni", emoji: "🚩" }
      );
      return void await interaction.reply({ content: "📦 Seleziona la categoria di destinazione:", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], flags: MessageFlags.Ephemeral });
    }
    case "ticket:transcript": {
      if (!owner && !staff) return void await interaction.reply({ content: "Non hai il permesso di generare il transcript.", flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await sendTranscript(channel, ticket);
      return void await interaction.editReply(`📝 Transcript generato. DM: **${result.dmSent ? "inviato" : "non inviato"}**. Canale log: **${result.logSent ? "inviato" : "non configurato"}**.`);
    }
    case "ticket:request-feedback": {
      if (!staff) return void await interaction.reply({ content: "Solo lo staff può richiedere il feedback.", flags: MessageFlags.Ephemeral });
      const sent = await requestFeedback(channel, ticket);
      return void await interaction.reply({
        content: sent ? "⭐ Richiesta di feedback inviata in privato all'utente." : "Non posso inviare il feedback: i DM dell'utente potrebbero essere chiusi.",
        flags: MessageFlags.Ephemeral
      });
    }
    case "ticket:close": {
      if (!owner && !staff) return void await interaction.reply({ content: "Non hai il permesso di chiudere questo ticket.", flags: MessageFlags.Ephemeral });
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("ticket:close-confirm").setLabel("Conferma chiusura").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket:close-cancel").setLabel("Annulla").setStyle(ButtonStyle.Secondary)
      );
      return void await interaction.reply({ content: "Sei sicuro di voler chiudere il ticket? Verrà generato il transcript.", components: [confirmRow], flags: MessageFlags.Ephemeral });
    }
    case "ticket:close-cancel":
      return void await interaction.update({ content: "Chiusura annullata.", components: [] });
    case "ticket:close-confirm": {
      if (!owner && !staff) return void await interaction.reply({ content: "Non hai il permesso di chiudere questo ticket.", flags: MessageFlags.Ephemeral });
      await interaction.update({ content: "🔄 Chiusura in corso e generazione transcript...", components: [] });
      const result = await sendTranscript(channel, ticket, interaction.user.tag);
      const feedbackSent = await requestFeedback(channel, ticket);
      deleteTicket(ticket.channelId);
      await interaction.followUp({
        content: `🔒 Ticket chiuso. Transcript DM: **${result.dmSent ? "inviato" : "non inviato"}**. Transcript log: **${result.logSent ? "inviato" : "non configurato"}**. Feedback: **${feedbackSent ? "richiesto" : "non inviato"}**.`,
        flags: MessageFlags.Ephemeral
      });
      setTimeout(() => void channel.delete("Ticket chiuso con transcript e feedback").catch(console.error), 4000);
      return;
    }
  }
}

export async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild || !interaction.customId.startsWith("ticket:")) return;
  if (!interaction.channelId) return void await interaction.reply({ content: "Interazione fuori da un canale ticket.", flags: MessageFlags.Ephemeral });
  const ticket = getTicket(interaction.channelId);
  if (!ticket) return void await interaction.reply({ content: "Questo canale non è un ticket.", flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!(await isStaffMember(member, ticket))) return void await interaction.reply({ content: "Solo lo staff può eseguire questa operazione.", flags: MessageFlags.Ephemeral });
  const channel = interaction.channel as TextChannel;

  if (interaction.customId === "ticket:rename-modal") {
    const name = safeRename(interaction.fields.getTextInputValue("channel-name"));
    if (!name) return void await interaction.reply({ content: "Nome non valido.", flags: MessageFlags.Ephemeral });
    await channel.setName(name);
    return void await interaction.reply(`✏️ Ticket rinominato in **${name}**.`);
  }

  const userId = interaction.fields.getTextInputValue("user-id").trim().replace(/[<@!>]/g, "");
  if (!/^\d{17,20}$/.test(userId)) return void await interaction.reply({ content: "Inserisci un ID utente Discord valido.", flags: MessageFlags.Ephemeral });
  if (interaction.customId === "ticket:add-user-modal") {
    await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    return void await interaction.reply(`👥 <@${userId}> è stato aggiunto al ticket.`);
  }
  if (interaction.customId === "ticket:remove-user-modal") {
    if (userId === ticket.ownerId) return void await interaction.reply({ content: "Non puoi rimuovere il proprietario del ticket.", flags: MessageFlags.Ephemeral });
    await channel.permissionOverwrites.delete(userId).catch(() => null);
    return void await interaction.reply(`🚫 <@${userId}> è stato rimosso dal ticket.`);
  }
}
