import { ChannelType } from 'discord.js';
import { forgetDayThread, getDayThreadId, saveDayThreadId } from './db.js';
import { prettyDate } from './dates.js';

/** Discord chỉ nhận 4 mốc này; 1440 phút = tự lưu trữ sau đúng 24 giờ. */
const AUTO_ARCHIVE_MINUTES = 1440;

export function dayThreadName(date) {
  return `📅 ${prettyDate(date)}`;
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

/**
 * Thread của ngày `date` trong kênh đã cấu hình. Tạo mới nếu chưa có,
 * mở lại nếu lỡ bị lưu trữ sớm, và quên id cũ nếu thread đã bị xoá.
 * Trả null khi tắt chế độ thread hoặc bot thiếu quyền — người gọi tự lùi về kênh.
 */
export async function ensureDayThread(client, guildCfg, date) {
  if (!guildCfg.use_threads) return null;

  const channel = await fetchTextChannel(client, guildCfg.channel_id);
  if (!channel || channel.isThread()) return null;

  const knownId = getDayThreadId(guildCfg.guild_id, date);
  if (knownId) {
    try {
      const thread = await client.channels.fetch(knownId);
      if (thread) {
        if (thread.archived) await thread.setArchived(false);
        return thread;
      }
    } catch {
      // Thread bị xoá tay -> bỏ id cũ rồi tạo lại bên dưới.
      forgetDayThread(guildCfg.guild_id, date);
    }
  }

  try {
    const thread = await channel.threads.create({
      name: dayThreadName(date),
      autoArchiveDuration: AUTO_ARCHIVE_MINUTES,
      type: ChannelType.PublicThread,
      reason: `Thread báo cáo ngày ${date}`,
    });
    saveDayThreadId(guildCfg.guild_id, date, thread.id);
    return thread;
  } catch (err) {
    console.error(`[threads] không tạo được thread ${date}:`, err.message);
    return null;
  }
}

/**
 * Nơi để đăng nội dung công khai của ngày: ưu tiên thread, không được thì về kênh.
 * Trả { target, isThread } — target là null nếu chưa cấu hình kênh.
 */
export async function dayDestination(client, guildCfg, date) {
  const thread = await ensureDayThread(client, guildCfg, date);
  if (thread) return { target: thread, isThread: true };
  const channel = await fetchTextChannel(client, guildCfg.channel_id);
  return { target: channel, isThread: false };
}
