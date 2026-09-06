import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import {
  addDays,
  hourOfDay,
  isRequiredDay,
  logicalDate,
  prettyRange,
  weekStartOf,
  weekdayOf,
} from './dates.js';
import {
  listActiveUsers,
  listConfiguredGuilds,
  listDailyDates,
  userIdsReportedOn,
  usersWithPlan,
  usersWithDailiesBetween,
} from './db.js';
import { computeStreak, streakBadge } from './xp.js';
import { COLORS, runWeeklyReview } from './review.js';
import { isAiEnabled } from './ai.js';
import { dayDestination } from './threads.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChannel(client, channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

/** Ai chưa báo cáo hôm nay, kèm streak đang treo. */
function pendingUsers(guildId, today) {
  const done = userIdsReportedOn(guildId, today);
  return listActiveUsers(guildId)
    .filter((u) => !done.has(u.user_id))
    .map((u) => ({ ...u, streak: computeStreak(listDailyDates(guildId, u.user_id), addDays(today, -1)) }));
}

async function sendDailyReminder(client, guildCfg, { lastCall, today = logicalDate() }) {
  // Ngay khong bat buoc: chi nhac neu server bat, va khong bao gio goi lan cuoi.
  const required = isRequiredDay(today);
  if (!required && (!guildCfg.remind_weekends || lastCall)) return;

  // Nhắc trong thread của ngày: ping vẫn báo như thường, mà kênh chính không bị dồn tin.
  const { target: channel } = await dayDestination(client, guildCfg, today);
  if (!channel) return;

  const pending = pendingUsers(guildCfg.guild_id, today);
  const roster = listActiveUsers(guildCfg.guild_id);
  if (!roster.length) return;

  if (!pending.length) {
    if (!lastCall) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.ok)
            .setDescription('🎉 Cả nhóm đã báo cáo đủ hôm nay. Streak an toàn.'),
        ],
      });
    }
    return;
  }

  // Ngày không bắt buộc thì không doạ mất streak, vì bỏ qua thật sự không mất gì.
  const lines = pending.map((u) => {
    const risk =
      required && u.streak > 0
        ? ` — đang giữ ${streakBadge(u.streak)} **${u.streak}** ngày, mất thì tiếc lắm`
        : '';
    return `<@${u.user_id}>${risk}`;
  });

  const closing = !required
    ? 'Cuối tuần không bắt buộc — bỏ qua **không đứt streak**. Nhưng có động tay vào gì thì cứ ghi lại, để bản tổng kết cuối tuần không bỏ sót công của bạn.'
    : lastCall
      ? 'Hôm nay bạn thực sự đã làm được gì? Gõ `/daily` — kể cả một dòng thành thật vẫn hơn một ngày trống.'
      : 'Gõ `/daily` để ghi lại. Viết cụ thể vào, cuối tuần trợ lý sẽ đối chiếu với kế hoạch bạn đã cam kết.';

  const embed = new EmbedBuilder()
    .setColor(!required ? COLORS.neutral : lastCall ? COLORS.bad : COLORS.warn)
    .setTitle(
      !required
        ? '🌤️ Cuối tuần — ghi lại nếu có làm gì'
        : lastCall
          ? '⏰ Gọi lần cuối trong ngày'
          : '📝 Tới giờ báo cáo rồi',
    )
    .setDescription(`${lines.join('\n')}\n\n${closing}`);

  await channel.send({ embeds: [embed] });
}

async function runWeeklyForGuild(client, guildCfg, today = logicalDate()) {
  const channel = await fetchChannel(client, guildCfg.channel_id);
  if (!channel) return;

  // Thứ 2 thì tổng kết tuần vừa khép lại; các ngày khác tổng kết chính tuần đang chạy.
  const anchor = weekdayOf(today) === 1 ? addDays(today, -1) : today;
  const weekStart = weekStartOf(anchor);
  const weekEnd = addDays(weekStart, 6);

  const userIds = [
    ...new Set([
      ...usersWithDailiesBetween(guildCfg.guild_id, weekStart, weekEnd),
      ...usersWithPlan(guildCfg.guild_id, weekStart),
    ]),
  ];
  if (!userIds.length) return;

  const guild = await client.guilds.fetch(guildCfg.guild_id).catch(() => null);

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`📊 Tổng kết tuần ${prettyRange(weekStart, weekEnd)}`)
        .setDescription('Trợ lý đang đọc lại toàn bộ báo cáo trong tuần…'),
    ],
  });

  for (const userId of userIds) {
    const member = await guild?.members.fetch(userId).catch(() => null);
    const { embed, error } = await runWeeklyReview({
      guildId: guildCfg.guild_id,
      userId,
      weekStart,
      displayName: member?.displayName ?? member?.user.username ?? `User ${userId}`,
      avatarUrl: member?.user.displayAvatarURL(),
    });

    await channel.send({
      content: `<@${userId}>${error ? `\n⚠️ Không gọi được AI: ${error.message}` : ''}`,
      embeds: [embed],
    });
    if (isAiEnabled()) await sleep(4000); // nhẹ tay với free tier của Gemini
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('🔁 Vòng lặp tiếp theo')
        .setDescription(
          'Đọc xong nhận xét rồi thì chốt luôn cam kết cho tuần tới bằng `/weekly plan` (+25 XP).\n' +
            'Tuần sau trợ lý sẽ lấy đúng bản kế hoạch đó ra đối chiếu với những gì bạn thật sự làm.',
        ),
    ],
  });
}

/** Một cron mỗi giờ, đọc cấu hình từng guild — đổi giờ nhắc không cần khởi động lại bot. */
export function startScheduler(client) {
  const task = cron.schedule(
    '0 * * * *',
    async () => {
      const hour = hourOfDay();
      const today = logicalDate();

      for (const guildCfg of listConfiguredGuilds()) {
        try {
          if (hour === guildCfg.remind_hour) {
            await sendDailyReminder(client, guildCfg, { lastCall: false, today });
          }
          if (hour === guildCfg.last_call_hour && guildCfg.last_call_hour !== guildCfg.remind_hour) {
            await sendDailyReminder(client, guildCfg, { lastCall: true, today });
          }
          if (hour === guildCfg.weekly_hour && weekdayOf(today) === guildCfg.weekly_dow) {
            await runWeeklyForGuild(client, guildCfg, today);
          }
        } catch (err) {
          console.error(`[scheduler] guild ${guildCfg.guild_id}:`, err);
        }
      }
    },
    { timezone: config.timezone },
  );

  console.log(`[scheduler] đang chạy theo múi giờ ${config.timezone}`);
  return task;
}

export const _internals = { sendDailyReminder, runWeeklyForGuild };
