import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { commandsByName, modalHandlers } from './commands/index.js';
import { startScheduler } from './scheduler.js';
import { getGuildConfig } from './db.js';
import { isAiEnabled } from './ai.js';

assertRuntimeConfig();

// Chỉ cần intent Guilds: dữ liệu member lấy qua payload của interaction và REST,
// nên không phải bật privileged intent nào trong Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] đăng nhập với tên ${c.user.tag}`);
  console.log(`[bot] múi giờ ${config.timezone} · streak ${config.streakMode} · AI ${isAiEnabled() ? 'bật' : 'tắt'}`);
  for (const guild of c.guilds.cache.values()) getGuildConfig(guild.id);
  startScheduler(client);
});

client.on(Events.GuildCreate, (guild) => {
  getGuildConfig(guild.id);
});

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (err) {
    console.error('[bot] không gửi được thông báo lỗi:', err);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'Bot chỉ hoạt động trong server, không dùng qua tin nhắn riêng.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const handler = modalHandlers.get(interaction.customId.split(':')[0]);
      if (!handler) return;
      await handler.handleModal(interaction);
    }
  } catch (err) {
    console.error(`[bot] lỗi khi xử lý ${interaction.commandName ?? interaction.customId}:`, err);
    await safeReply(interaction, `Có lỗi xảy ra: ${err.message ?? err}`);
  }
});

client.on(Events.Error, (err) => console.error('[bot] lỗi client:', err));
process.on('unhandledRejection', (err) => console.error('[bot] promise chưa bắt:', err));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[bot] nhận ${signal}, đang tắt…`);
    client.destroy().finally(() => process.exit(0));
  });
}

client.login(config.token);
