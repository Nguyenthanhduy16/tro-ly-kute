import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { addDays, hourOfDay, logicalDate, prettyDate } from '../dates.js';
import {
  addXp,
  getDaily,
  getGuildConfig,
  getUser,
  listDailyDates,
  recordBestStreak,
  saveDaily,
  setDailyMessageId,
  touchUser,
} from '../db.js';
import { dayDestination } from '../threads.js';
import { nextRank, syncRank } from '../ranks.js';
import { computeStreak, levelProgress, progressBar, scoreDaily, streakBadge } from '../xp.js';
import { COLORS } from '../review.js';

export const data = new SlashCommandBuilder()
  .setName('daily')
  .setDescription('Nộp báo cáo công việc trong ngày')
  .addStringOption((o) =>
    o
      .setName('done')
      .setDescription(`Hôm nay bạn đã làm được gì? (tối thiểu ${config.minDoneLength} ký tự)`)
      .setRequired(false),
  )
  .addStringOption((o) =>
    o.setName('next').setDescription('Việc kế tiếp bạn định làm').setRequired(false),
  )
  .addStringOption((o) =>
    o.setName('blocker').setDescription('Vướng mắc / thứ làm bạn chậm lại').setRequired(false),
  )
  .addStringOption((o) =>
    o
      .setName('day')
      .setDescription('Báo cáo cho ngày nào (mặc định: hôm nay)')
      .addChoices({ name: 'Hôm nay', value: 'today' }, { name: 'Hôm qua', value: 'yesterday' })
      .setRequired(false),
  );

function resolveDate(dayChoice) {
  const today = logicalDate();
  return dayChoice === 'yesterday' ? addDays(today, -1) : today;
}

export async function execute(interaction) {
  const date = resolveDate(interaction.options.getString('day'));
  const done = interaction.options.getString('done');

  // Không truyền nội dung -> mở modal nhiều dòng (gõ báo cáo dài trong ô lệnh rất khổ).
  if (!done) {
    const existing = getDaily(interaction.guildId, interaction.user.id, date);
    return interaction.showModal(buildModal(date, existing));
  }

  return submit(interaction, {
    date,
    done,
    nextPlan: interaction.options.getString('next') ?? '',
    blocker: interaction.options.getString('blocker') ?? '',
  });
}

export const modalPrefix = 'daily';

export async function handleModal(interaction) {
  const date = interaction.customId.split(':')[1] ?? logicalDate();
  return submit(interaction, {
    date,
    done: interaction.fields.getTextInputValue('done'),
    nextPlan: interaction.fields.getTextInputValue('next') ?? '',
    blocker: interaction.fields.getTextInputValue('blocker') ?? '',
  });
}

export function buildModal(date, existing) {
  const modal = new ModalBuilder()
    .setCustomId(`daily:${date}`)
    .setTitle(`Báo cáo ${prettyDate(date)}`);

  const done = new TextInputBuilder()
    .setCustomId('done')
    .setLabel('Hôm nay bạn đã làm được gì?')
    .setPlaceholder('Cụ thể vào: xong cái gì, tới đâu, kết quả đo được ra sao.')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(config.minDoneLength)
    .setMaxLength(1500)
    .setRequired(true);

  const next = new TextInputBuilder()
    .setCustomId('next')
    .setLabel('Việc kế tiếp')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(800)
    .setRequired(false);

  const blocker = new TextInputBuilder()
    .setCustomId('blocker')
    .setLabel('Vướng mắc (nếu có)')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(800)
    .setRequired(false);

  if (existing) {
    done.setValue(existing.done.slice(0, 1500));
    if (existing.next_plan) next.setValue(existing.next_plan.slice(0, 800));
    if (existing.blocker) blocker.setValue(existing.blocker.slice(0, 800));
  }

  return modal.addComponents(
    new ActionRowBuilder().addComponents(done),
    new ActionRowBuilder().addComponents(next),
    new ActionRowBuilder().addComponents(blocker),
  );
}

async function submit(interaction, { date, done, nextPlan, blocker }) {
  const trimmed = done.trim();
  if (trimmed.length < config.minDoneLength) {
    return interaction.reply({
      content:
        `Báo cáo cần ít nhất **${config.minDoneLength} ký tự** (bạn viết ${trimmed.length}).\n` +
        'Viết cụ thể giúp bản đánh giá cuối tuần có căn cứ — "làm việc với dự án" thì cuối tuần không ai biết bạn đã làm gì.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Từ đây trở đi là tạo thread, gán role, đăng bài — toàn gọi REST và dư sức
  // vượt 3 giây Discord cho phép trả lời. Giữ chỗ trước, sửa lại nội dung sau,
  // nếu không sẽ ăn 10062 Unknown interaction đúng vào hôm đầu tiên của ngày.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { guildId } = interaction;
  const userId = interaction.user.id;
  const displayName = interaction.member?.displayName ?? interaction.user.username;
  touchUser(guildId, userId, displayName);

  const existing = getDaily(guildId, userId, date);
  const isEdit = Boolean(existing);

  const datesAfter = new Set(listDailyDates(guildId, userId));
  datesAfter.add(date);
  const streak = computeStreak(datesAfter, logicalDate());

  const onTime = date === logicalDate() && hourOfDay() < config.onTimeHour;
  const { total, breakdown } = isEdit
    ? { total: existing.xp, breakdown: null }
    : scoreDaily({ done: trimmed, nextPlan, blocker, streak, onTime });

  saveDaily({
    guildId,
    userId,
    date,
    done: trimmed,
    nextPlan: nextPlan.trim(),
    blocker: blocker.trim(),
    xp: total,
    onTime,
  });

  const previousRank = getUser(guildId, userId)?.rank_key ?? null;

  if (!isEdit) {
    addXp(guildId, userId, total);
    recordBestStreak(guildId, userId, streak);
  }

  const user = touchUser(guildId, userId, displayName);
  const prog = levelProgress(user.xp);

  const promotion = isEdit
    ? { promoted: false, rank: null }
    : await syncRank(interaction.guild, userId, user.xp, previousRank);

  const embed = new EmbedBuilder()
    .setColor(isEdit ? COLORS.neutral : COLORS.ok)
    .setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${isEdit ? '✏️ Đã cập nhật' : '✅ Đã ghi nhận'} báo cáo — ${prettyDate(date)}`)
    .addFields({ name: 'Đã làm', value: truncate(trimmed, 1000) });

  if (nextPlan.trim()) embed.addFields({ name: 'Kế tiếp', value: truncate(nextPlan.trim(), 500) });
  if (blocker.trim()) embed.addFields({ name: '⚠️ Vướng mắc', value: truncate(blocker.trim(), 500) });

  embed.addFields(
    {
      name: 'Streak',
      value: `${streakBadge(streak)} **${streak}** ngày`,
      inline: true,
    },
    {
      name: isEdit ? 'XP (không cộng thêm khi sửa)' : 'XP nhận được',
      value: isEdit ? `+${total}` : `**+${total}**\n${formatBreakdown(breakdown)}`,
      inline: true,
    },
    {
      name: `Level ${prog.level}`,
      value: `${progressBar(prog.into, prog.need)}\n${user.xp} XP · còn ${prog.need - prog.into} tới lv.${prog.level + 1}`,
      inline: true,
    },
  );

  return publish(interaction, { embed, date, isEdit, xp: total, streak, promotion, displayName, totalXp: user.xp });
}

/**
 * Báo cáo được đăng công khai vào thread của ngày hôm đó, còn người gõ lệnh
 * chỉ nhận một dòng xác nhận riêng — tránh cùng một nội dung xuất hiện hai lần.
 * Sửa báo cáo thì chỉnh lại đúng tin nhắn cũ chứ không đăng thêm.
 */
function promotionEmbed({ displayName, rank, totalXp }) {
  const upcoming = nextRank(totalXp);
  return new EmbedBuilder()
    .setColor(rank.color)
    .setTitle(`🎉 ${displayName} vừa lên ${rank.name}`)
    .setDescription(
      'Tên của bạn trong server từ giờ mang màu này.\n' +
        (upcoming
          ? `Cấp kế tiếp: **${upcoming.rank.name}** — còn **${upcoming.missing} XP**.`
          : 'Đây là cấp cao nhất. Không còn gì để leo, chỉ còn giữ.'),
    );
}

async function publish(interaction, { embed, date, isEdit, xp, streak, promotion, displayName, totalXp }) {
  const guildCfg = getGuildConfig(interaction.guildId);
  const { target } = await dayDestination(interaction.client, guildCfg, date);

  // Chưa cấu hình kênh -> đăng ngay tại chỗ vừa gõ lệnh, đừng để báo cáo rơi vào hư không.
  const channel = target ?? interaction.channel;
  if (!channel) return interaction.editReply({ embeds: [embed] });

  const known = getDaily(interaction.guildId, interaction.user.id, date)?.message_id;
  let posted = null;

  if (isEdit && known) {
    posted = await channel.messages.fetch(known).then((m) => m.edit({ embeds: [embed] })).catch(() => null);
  }
  if (!posted) {
    posted = await channel.send({ embeds: [embed] }).catch(() => null);
  }
  if (!posted) {
    // Không đăng được (thiếu quyền chẳng hạn) -> ít nhất người gõ vẫn thấy kết quả.
    return interaction.editReply({ embeds: [embed] });
  }

  setDailyMessageId(interaction.guildId, interaction.user.id, date, posted.id);

  if (promotion?.promoted) {
    await channel
      .send({ embeds: [promotionEmbed({ displayName, rank: promotion.rank, totalXp })] })
      .catch(() => null);
  }

  return interaction.editReply({
    content:
      `${isEdit ? '✏️ Đã cập nhật' : '✅ Đã ghi nhận'} báo cáo ${prettyDate(date)} · ` +
      `**+${xp} XP** · streak **${streak}**\n→ ${posted.url}`,
  });
}

function formatBreakdown(b) {
  if (!b) return '';
  const parts = [`nền ${b.base}`];
  if (b.quality) parts.push(`chi tiết +${b.quality}`);
  if (b.nextPlan) parts.push(`có kế hoạch +${b.nextPlan}`);
  if (b.blocker) parts.push(`nêu vướng mắc +${b.blocker}`);
  if (b.onTime) parts.push(`đúng hạn +${b.onTime}`);
  if (b.streak) parts.push(`streak +${b.streak}`);
  return `*${parts.join(' · ')}*`;
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
