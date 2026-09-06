import { EmbedBuilder } from 'discord.js';
import {
  getPlan,
  getUser,
  listDailiesBetween,
  listDailyDates,
  saveReview,
} from './db.js';
import { isRequiredDay, logicalDate, prettyRange, weekDays } from './dates.js';
import { computeStreak, streakBadge } from './xp.js';
import { generateWeeklyReview } from './ai.js';

export const COLORS = {
  ok: 0x57f287,
  warn: 0xfee75c,
  bad: 0xed4245,
  info: 0x5865f2,
  neutral: 0x99aab5,
};

/**
 * Gom toàn bộ dữ liệu một tuần của user + số liệu dẫn xuất.
 * `today` chỉ truyền vào khi cần cố định mốc thời gian (test).
 */
export function collectWeek(guildId, userId, weekStart, today = logicalDate()) {
  const days = weekDays(weekStart);
  const weekEnd = days[6];

  const dailies = listDailiesBetween(guildId, userId, weekStart, weekEnd);
  const reported = new Set(dailies.map((d) => d.report_date));

  // Chỉ tính những ngày bắt buộc đã trôi qua — review giữa tuần không phạt ngày chưa tới.
  const dueDays = days.filter((d) => isRequiredDay(d) && d <= today);
  const missed = dueDays.filter((d) => !reported.has(d));

  const totalChars = dailies.reduce((sum, d) => sum + d.done.length, 0);
  const stats = {
    reported: dailies.length,
    expected: dueDays.length,
    missed,
    totalChars,
    avgChars: dailies.length ? Math.round(totalChars / dailies.length) : 0,
    blockerDays: dailies.filter((d) => d.blocker.trim()).length,
    xpEarned: dailies.reduce((sum, d) => sum + d.xp, 0),
    streak: computeStreak(listDailyDates(guildId, userId), today),
    bestStreak: getUser(guildId, userId)?.best_streak ?? 0,
  };

  return { days, weekStart, weekEnd, dailies, plan: getPlan(guildId, userId, weekStart)?.plan ?? '', stats };
}

/** Dải ô vuông cho 7 ngày trong tuần: ✅ có báo cáo, ⬜ ngày nghỉ, ❌ bỏ lỡ, ▫️ chưa tới. */
export function weekStrip(days, dailies, today = logicalDate()) {
  const reported = new Set(dailies.map((d) => d.report_date));
  return days
    .map((d) => {
      if (reported.has(d)) return '✅';
      if (!isRequiredDay(d)) return '⬜';
      if (d > today) return '▫️';
      return '❌';
    })
    .join(' ');
}

function scoreColor(score) {
  if (score === null || score === undefined) return COLORS.info;
  if (score >= 7.5) return COLORS.ok;
  if (score >= 5) return COLORS.warn;
  return COLORS.bad;
}

/** Embed nhận xét tuần (kèm số liệu). `reviewText` có thể là null khi chưa bật AI. */
export function buildReviewEmbed({ displayName, avatarUrl, week, reviewText, score }) {
  const { weekStart, weekEnd, days, dailies, stats, plan } = week;
  const rate = stats.expected ? Math.round((stats.reported / stats.expected) * 100) : 0;

  const embed = new EmbedBuilder()
    .setColor(scoreColor(score))
    .setAuthor({ name: `Đánh giá tuần — ${displayName}`, iconURL: avatarUrl ?? undefined })
    .setTitle(prettyRange(weekStart, weekEnd))
    .setDescription(reviewText ? reviewText.slice(0, 4000) : '*Chưa bật AI review — dưới đây chỉ là số liệu thô.*')
    .addFields(
      {
        name: 'Chuyên cần',
        value: `${weekStrip(days, dailies)}\n**${stats.reported}/${stats.expected}** ngày (${rate}%)`,
        inline: true,
      },
      {
        name: 'Streak',
        value: `${streakBadge(stats.streak)} **${stats.streak}** ngày\nKỷ lục: ${stats.bestStreak}`,
        inline: true,
      },
      { name: 'XP tuần', value: `**+${stats.xpEarned}**`, inline: true },
    );

  if (score !== null && score !== undefined) {
    embed.setFooter({ text: `Điểm tuần: ${score}/10 · ${plan ? 'có kế hoạch tuần' : 'KHÔNG có kế hoạch tuần'}` });
  } else {
    embed.setFooter({ text: plan ? 'Có kế hoạch tuần' : 'KHÔNG có kế hoạch tuần' });
  }
  return embed;
}

/**
 * Chạy review đầy đủ cho một user trong một tuần: gom dữ liệu → gọi AI → lưu → trả embed.
 * `force` bỏ qua bản review đã lưu.
 */
export async function runWeeklyReview({ guildId, userId, weekStart, displayName, avatarUrl }) {
  const week = collectWeek(guildId, userId, weekStart);

  let reviewText = null;
  let score = null;
  let error = null;

  try {
    const result = await generateWeeklyReview({
      displayName,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      plan: week.plan,
      dailies: week.dailies,
      stats: week.stats,
    });
    reviewText = result.text;
    score = result.score;
    saveReview(guildId, userId, weekStart, reviewText, score);
  } catch (err) {
    error = err;
  }

  return {
    week,
    error,
    embed: buildReviewEmbed({ displayName, avatarUrl, week, reviewText, score }),
  };
}
