import 'dotenv/config';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Chọn nhà cung cấp AI. AI_PROVIDER ghi đè; không đặt thì ưu tiên key nào đang có.
 * Mỗi provider tự mang endpoint, key và model của nó để phần còn lại của bot
 * không phải biết đang nói chuyện với ai.
 */
function aiConfig() {
  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const provider = process.env.AI_PROVIDER || (openrouterKey ? 'openrouter' : 'gemini');

  if (provider === 'openrouter') {
    return {
      provider,
      apiKey: openrouterKey,
      model: process.env.OPENROUTER_MODEL || 'google/gemini-3.1-pro-preview',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      keyEnvVar: 'OPENROUTER_API_KEY',
      keyUrl: 'https://openrouter.ai/keys',
    };
  }

  return {
    provider: 'gemini',
    apiKey: geminiKey,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnvVar: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
  };
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || null,

  // Múi giờ dùng cho mọi phép tính "ngày", cron nhắc nhở và weekly review.
  timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',

  // Báo cáo gửi trước giờ này được tính cho NGÀY HÔM TRƯỚC (dành cho cú đêm).
  dayRolloverHour: num(process.env.DAY_ROLLOVER_HOUR, 4),

  // 'weekdays' = nghỉ T7/CN không mất streak. 'everyday' = ngày nào cũng phải báo cáo.
  streakMode: process.env.STREAK_MODE === 'everyday' ? 'everyday' : 'weekdays',

  // Nộp trước giờ này được +XP đúng hạn.
  onTimeHour: num(process.env.ON_TIME_HOUR, 22),

  ai: aiConfig(),

  minDoneLength: num(process.env.MIN_DONE_LENGTH, 40),
};

export function assertRuntimeConfig() {
  const missing = ['token', 'clientId'].filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(
      `Thiếu biến môi trường: ${missing.map((k) => (k === 'token' ? 'DISCORD_TOKEN' : 'DISCORD_CLIENT_ID')).join(', ')}. Xem .env.example`,
    );
  }
}
