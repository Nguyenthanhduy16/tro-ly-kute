import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { addDays, isRequiredDay, logicalDate, prettyDate } from '../dates.js';
import { getUser, listDailyDates, listRecentDailies, touchUser } from '../db.js';
import { computeStreak, levelProgress, progressBar, streakBadge } from '../xp.js';
import { COLORS } from '../review.js';

export const data = new SlashCommandBuilder()
  .setName('streak')
  .setDescription('Xem streak, XP và mức độ chuyên cần')
  .addUserOption((o) => o.setName('user').setDescription('Xem của ai (mặc định: bạn)'));

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const { guildId } = interaction;
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const displayName = member?.displayName ?? target.username;

  touchUser(guildId, target.id, displayName);
  const user = getUser(guildId, target.id);
  const dates = listDailyDates(guildId, target.id);
  const today = logicalDate();
  const streak = computeStreak(dates, today);
  const prog = levelProgress(user.xp);
  const reported = new Set(dates);

  const last14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const strip = last14
    .map((d) => {
      if (reported.has(d)) return '🟩';
      if (!isRequiredDay(d)) return '⬛';
      return '🟥';
    })
    .join('');

  const recent = listRecentDailies(guildId, target.id, 30);
  const avgChars = recent.length
    ? Math.round(recent.reduce((s, d) => s + d.done.length, 0) / recent.length)
    : 0;

  const embed = new EmbedBuilder()
    .setColor(streak > 0 ? COLORS.ok : COLORS.warn)
    .setAuthor({ name: displayName, iconURL: target.displayAvatarURL() })
    .setTitle(`${streakBadge(streak)} Streak ${streak} ngày`)
    .setDescription(`**14 ngày gần nhất**\n${strip}\n*🟩 có báo cáo · 🟥 bỏ lỡ · ⬛ ngày nghỉ*`)
    .addFields(
      { name: 'Kỷ lục', value: `${user.best_streak} ngày`, inline: true },
      { name: 'Tổng số báo cáo', value: `${dates.length}`, inline: true },
      { name: 'Độ dài TB', value: `${avgChars} ký tự`, inline: true },
      {
        name: `Level ${prog.level} · ${user.xp} XP`,
        value: `${progressBar(prog.into, prog.need, 16)}  còn **${prog.need - prog.into}** XP tới level ${prog.level + 1}`,
      },
    )
    .setFooter({
      text: reported.has(today)
        ? `Đã báo cáo hôm nay (${prettyDate(today)})`
        : `Chưa báo cáo hôm nay (${prettyDate(today)}) — dùng /daily`,
    });

  return interaction.reply({ embeds: [embed] });
}
