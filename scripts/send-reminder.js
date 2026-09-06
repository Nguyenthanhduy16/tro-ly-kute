/**
 * Bắn lời nhắc ngay lập tức, không đợi cron — để thử hoặc để hối thủ công.
 *
 *   npm run remind                  # nhắc cho hôm nay
 *   npm run remind -- 2026-09-07    # nhắc như thể hôm đó là ngày cần báo cáo
 *   npm run remind -- --last-call   # dùng giọng gọi lần cuối
 *
 * Chạy được song song với bot đang bật; nó đăng nhập riêng rồi thoát.
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { assertRuntimeConfig, config } from '../src/config.js';
import { listConfiguredGuilds } from '../src/db.js';
import { isRequiredDay, logicalDate } from '../src/dates.js';
import { _internals } from '../src/scheduler.js';

assertRuntimeConfig();

const args = process.argv.slice(2);
const lastCall = args.includes('--last-call');
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const today = dateArg ?? logicalDate();

const guilds = listConfiguredGuilds();
if (!guilds.length) {
  console.error('❌ Chưa server nào đặt kênh. Chạy /setup set channel:#kênh trong Discord trước.');
  process.exit(1);
}

// Ngày không bắt buộc vẫn nhắc được, miễn server đã bật remind_weekends.
const required = isRequiredDay(today);
if (!required) {
  const willSend = guilds.filter((g) => g.remind_weekends && !lastCall);
  console.log(`ℹ️  ${today} không phải ngày bắt buộc (STREAK_MODE=${config.streakMode}).`);
  if (!willSend.length) {
    console.log('   Không server nào bật nhắc cuối tuần, hoặc bạn đang dùng --last-call.');
    console.log('   Bật bằng /setup set weekend_remind:True, hoặc truyền một ngày trong tuần.');
    process.exit(0);
  }
  console.log(`   ${willSend.length} server đã bật nhắc cuối tuần → gửi bản nhẹ nhàng, không doạ mất streak.`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`[remind] đăng nhập ${c.user.tag} · ngày ${today} · ${lastCall ? 'gọi lần cuối' : 'nhắc thường'}`);
  for (const guildCfg of guilds) {
    try {
      await _internals.sendDailyReminder(client, guildCfg, { lastCall, today });
      console.log(`[remind] đã xử lý server ${guildCfg.guild_id} → kênh ${guildCfg.channel_id}`);
    } catch (err) {
      console.error(`[remind] lỗi ở server ${guildCfg.guild_id}:`, err.message);
    }
  }
  await client.destroy();
  console.log('[remind] xong.');
});

client.login(config.token);
