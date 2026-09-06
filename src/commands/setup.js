import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig, getRankRoleId, setActive, touchUser, updateGuildConfig } from '../db.js';
import { COLORS } from '../review.js';
import { isAiEnabled } from '../ai.js';
import { RANKS, ensureRankRoles, rankRoleProblems, xpForRank } from '../ranks.js';

const DOW_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Cấu hình nhắc nhở và lịch đánh giá tuần')
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Cấu hình bot cho server này (cần quyền Manage Server)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Kênh bot gửi nhắc nhở và đánh giá tuần')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addIntegerOption((o) =>
        o.setName('remind_hour').setDescription('Giờ nhắc báo cáo (0-23)').setMinValue(0).setMaxValue(23),
      )
      .addIntegerOption((o) =>
        o.setName('last_call_hour').setDescription('Giờ nhắc lần cuối (0-23)').setMinValue(0).setMaxValue(23),
      )
      .addIntegerOption((o) =>
        o
          .setName('weekly_dow')
          .setDescription('Thứ chạy đánh giá tuần')
          .addChoices(...DOW_NAMES.map((name, value) => ({ name, value }))),
      )
      .addIntegerOption((o) =>
        o.setName('weekly_hour').setDescription('Giờ chạy đánh giá tuần (0-23)').setMinValue(0).setMaxValue(23),
      )
      .addBooleanOption((o) =>
        o
          .setName('threads')
          .setDescription('Gom báo cáo mỗi ngày vào một thread riêng (mặc định: bật)'),
      )
      .addBooleanOption((o) =>
        o
          .setName('weekend_remind')
          .setDescription('Nhắc cả T7/CN (bỏ qua vẫn không đứt streak)'),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('roles')
      .setDescription('Tạo các role cấp bậc đổi màu tên theo XP (cần quyền Manage Server)'),
  )
  .addSubcommand((s) => s.setName('show').setDescription('Xem cấu hình hiện tại'))
  .addSubcommand((s) => s.setName('pause').setDescription('Tạm ngưng nhắc nhở cho riêng bạn'))
  .addSubcommand((s) => s.setName('resume').setDescription('Bật lại nhắc nhở cho riêng bạn'));

async function rolesCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { created, existing, error } = await ensureRankRoles(interaction.guild);
  const problems = rankRoleProblems(interaction.guild);

  const lines = RANKS.map((r) => {
    const id = getRankRoleId(interaction.guildId, r.key);
    const mark = created.includes(r) ? 'mới tạo' : existing.includes(r) ? 'đã có' : '❌ chưa tạo được';
    return `${id ? `<@&${id}>` : r.name} — từ **${xpForRank(r)} XP** · ${mark}`;
  });

  const embed = new EmbedBuilder()
    .setColor(problems.length || error ? COLORS.warn : COLORS.ok)
    .setTitle('🎨 Role cấp bậc')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Role chỉ đổi màu tên, không tách mục riêng trong danh sách thành viên.' });

  if (error) {
    embed.addFields({ name: '❌ Lỗi khi tạo role', value: error.slice(0, 900) });
  }
  if (problems.length) {
    embed.addFields({ name: '⚠️ Cần sửa thì bot mới gán được role', value: problems.join('\n').slice(0, 900) });
  }
  if (!error && !problems.length) {
    embed.addFields({
      name: '✅ Sẵn sàng',
      value: 'Từ báo cáo tiếp theo, ai đạt mốc sẽ được gán role và đổi màu tên ngay.',
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const { guildId } = interaction;

  if (sub === 'pause' || sub === 'resume') {
    const displayName = interaction.member?.displayName ?? interaction.user.username;
    touchUser(guildId, interaction.user.id, displayName);
    setActive(guildId, interaction.user.id, sub === 'resume');
    return interaction.reply({
      content:
        sub === 'resume'
          ? '🔔 Đã bật lại nhắc nhở hàng ngày cho bạn.'
          : '🔕 Đã tắt nhắc nhở cho bạn. Streak vẫn tính bình thường — chỉ là không ai gọi bạn dậy nữa.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'roles') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: 'Bạn cần quyền **Manage Server** để tạo role.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return rolesCommand(interaction);
  }

  if (sub === 'set') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: 'Bạn cần quyền **Manage Server** để đổi cấu hình.',
        flags: MessageFlags.Ephemeral,
      });
    }
    const threads = interaction.options.getBoolean('threads');
    const weekendRemind = interaction.options.getBoolean('weekend_remind');
    updateGuildConfig(guildId, {
      use_threads: threads === null ? undefined : Number(threads),
      remind_weekends: weekendRemind === null ? undefined : Number(weekendRemind),
      channel_id: interaction.options.getChannel('channel')?.id,
      remind_hour: interaction.options.getInteger('remind_hour'),
      last_call_hour: interaction.options.getInteger('last_call_hour'),
      weekly_dow: interaction.options.getInteger('weekly_dow'),
      weekly_hour: interaction.options.getInteger('weekly_hour'),
    });
  }

  const cfg = getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(cfg.channel_id ? COLORS.ok : COLORS.warn)
    .setTitle('⚙️ Cấu hình trợ lý báo cáo')
    .addFields(
      {
        name: 'Kênh nhắc nhở',
        value: cfg.channel_id ? `<#${cfg.channel_id}>` : '❗ Chưa đặt — chạy `/setup set channel:#kênh`',
      },
      { name: 'Nhắc báo cáo', value: `${String(cfg.remind_hour).padStart(2, '0')}:00`, inline: true },
      { name: 'Nhắc lần cuối', value: `${String(cfg.last_call_hour).padStart(2, '0')}:00`, inline: true },
      {
        name: 'Đánh giá tuần',
        value: `${DOW_NAMES[cfg.weekly_dow]} ${String(cfg.weekly_hour).padStart(2, '0')}:00`,
        inline: true,
      },
      {
        name: 'Gom vào thread',
        value: cfg.use_threads
          ? 'Bật — mỗi ngày một thread, tự lưu trữ sau 24h'
          : 'Tắt — mọi thứ đăng thẳng ra kênh',
        inline: true,
      },
      { name: 'Múi giờ', value: config.timezone, inline: true },
      {
        name: 'Chế độ streak',
        value: config.streakMode === 'weekdays' ? 'Chỉ ngày trong tuần (T7/CN nghỉ)' : 'Mọi ngày',
        inline: true,
      },
      {
        name: 'Nhắc cuối tuần',
        value: cfg.remind_weekends ? 'Có — nhưng bỏ qua không đứt streak' : 'Không',
        inline: true,
      },
      {
        name: 'AI review',
        value: isAiEnabled()
          ? `✅ ${config.ai.provider}
\`${config.ai.model}\``
          : `❌ Chưa có ${config.ai.keyEnvVar}`,
        inline: true,
      },
    )
    .setFooter({ text: 'Múi giờ và chế độ streak đổi trong file .env rồi khởi động lại bot.' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
