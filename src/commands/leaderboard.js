import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { addDays, logicalDate, prettyRange, weekStartOf } from '../dates.js';
import { leaderboardAllTime, leaderboardBetween, listDailyDates } from '../db.js';
import { computeStreak, levelOf, streakBadge } from '../xp.js';
import { COLORS } from '../review.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Bảng xếp hạng XP')
  .addStringOption((o) =>
    o
      .setName('period')
      .setDescription('Khoảng thời gian (mặc định: tuần này)')
      .addChoices(
        { name: 'Tuần này', value: 'week' },
        { name: '30 ngày qua', value: 'month' },
        { name: 'Toàn thời gian', value: 'all' },
      ),
  );

const MEDALS = ['🥇', '🥈', '🥉'];

export async function execute(interaction) {
  const period = interaction.options.getString('period') ?? 'week';
  const { guildId } = interaction;
  const today = logicalDate();

  let rows;
  let subtitle;
  if (period === 'all') {
    rows = leaderboardAllTime(guildId, 15);
    subtitle = 'Toàn thời gian';
  } else {
    const from = period === 'month' ? addDays(today, -29) : weekStartOf(today);
    rows = leaderboardBetween(guildId, from, today, 15);
    subtitle = period === 'month' ? `30 ngày qua (${prettyRange(from, today)})` : `Tuần này (${prettyRange(from, today)})`;
  }

  if (!rows.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setTitle('🏅 Bảng xếp hạng')
          .setDescription('Chưa có ai báo cáo trong khoảng này. Mở hàng bằng `/daily` đi.'),
      ],
    });
  }

  const lines = rows.map((row, i) => {
    const rank = MEDALS[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    const streak = computeStreak(listDailyDates(guildId, row.user_id), today);
    const extra = period === 'all' ? `lv.${levelOf(row.xp)}` : `${row.reports} báo cáo`;
    return `${rank} <@${row.user_id}> — **${row.xp}** XP · ${extra} · ${streakBadge(streak)}${streak}`;
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🏅 Bảng xếp hạng XP')
    .setDescription(lines.join('\n'))
    .setFooter({ text: subtitle });

  return interaction.reply({ embeds: [embed] });
}
