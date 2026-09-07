import { getRankRoleId, saveRankRoleId, setUserRank } from './db.js';
import { levelOf } from './xp.js';

/**
 * Cấp bậc gắn với level (level = 40 × (cấp-1)² XP).
 * Level 1 cố ý không có role: ai cũng bắt đầu không màu, màu là thứ phải kiếm.
 * Khoảng cách nới dần ở cuối để cấp cao vẫn còn giá trị sau nhiều tháng.
 */
export const RANKS = [
  { key: 'mam', level: 2, name: '🌱 Mầm', color: 0x57f287 },
  { key: 'deu', level: 3, name: '⚡ Đều đặn', color: 0x1abc9c },
  { key: 'ben', level: 4, name: '🔥 Bền bỉ', color: 0x3498db },
  { key: 'kyluat', level: 5, name: '💎 Kỷ luật', color: 0x9b59b6 },
  { key: 'thep', level: 6, name: '🏆 Thép', color: 0xf1c40f },
  { key: 'huyenthoai', level: 8, name: '👑 Huyền thoại', color: 0xe74c3c },
];

export const RANK_BY_KEY = new Map(RANKS.map((r) => [r.key, r]));

/**
 * Role riêng cho chính bot, chỉ để tên nó trong danh sách thành viên có màu.
 * Discord lấy màu tên từ role CÓ MÀU cao nhất, mà role tích hợp Discord tự tạo
 * cho bot lại không màu — nên chỉ cần thêm một role màu là đủ, không phải đụng
 * vào role tích hợp (Discord khoá, sửa không được).
 */
export const BOT_ROLE = { key: 'bot', name: '🤖 Trợ lý', color: 0xff9ecd };

/** XP cần để chạm một cấp — ngược từ công thức level. */
export function xpForRank(rank) {
  return 40 * (rank.level - 1) ** 2;
}

/** Cấp hiện tại theo XP; null nếu chưa đạt cấp nào. */
export function rankFor(xp) {
  const level = levelOf(xp);
  let current = null;
  for (const rank of RANKS) {
    if (level >= rank.level) current = rank;
  }
  return current;
}

/** Cấp kế tiếp và số XP còn thiếu; null nếu đã đạt đỉnh. */
export function nextRank(xp) {
  const next = RANKS.find((r) => levelOf(xp) < r.level);
  return next ? { rank: next, missing: xpForRank(next) - xp } : null;
}

/**
 * Tạo đủ 6 role trong server (bỏ qua role đã có).
 * Trả { created, existing, error } để lệnh /setup báo lại cho người dùng.
 */
export async function ensureRankRoles(guild) {
  const created = [];
  const existing = [];

  for (const rank of RANKS) {
    const knownId = getRankRoleId(guild.id, rank.key);
    if (knownId && guild.roles.cache.has(knownId)) {
      existing.push(rank);
      continue;
    }

    // Role có thể đã được tạo tay từ trước, hoặc id cũ đã chết — dò theo tên trước khi tạo mới.
    const byName = guild.roles.cache.find((r) => r.name === rank.name);
    if (byName) {
      saveRankRoleId(guild.id, rank.key, byName.id);
      existing.push(rank);
      continue;
    }

    try {
      const role = await guild.roles.create({
        name: rank.name,
        color: rank.color,
        hoist: false, // chỉ đổi màu tên, không tách thành mục riêng trong danh sách
        mentionable: false,
        reason: 'Cấp bậc theo XP của trợ lý báo cáo',
      });
      saveRankRoleId(guild.id, rank.key, role.id);
      created.push(rank);
    } catch (err) {
      return { created, existing, error: err.message };
    }
  }

  return { created, existing, error: null };
}

/**
 * Tạo role màu cho chính bot rồi tự đeo vào.
 * Trả { role, wearer, error } — `wearer.roles.color` cho biết role nào đang
 * thật sự quyết định màu tên, vì một role có màu nằm cao hơn sẽ đè lên.
 */
export async function ensureBotRole(guild) {
  const me = guild.members.me;
  if (!me) return { role: null, wearer: null, error: 'Không đọc được thông tin của bot trong server.' };

  const knownId = getRankRoleId(guild.id, BOT_ROLE.key);
  let role =
    (knownId && guild.roles.cache.get(knownId)) ||
    guild.roles.cache.find((r) => r.name === BOT_ROLE.name) ||
    null;

  if (!role) {
    try {
      role = await guild.roles.create({
        name: BOT_ROLE.name,
        color: BOT_ROLE.color,
        hoist: false,
        mentionable: false,
        reason: 'Màu tên cho chính bot',
      });
    } catch (err) {
      return { role: null, wearer: me, error: err.message };
    }
  }
  saveRankRoleId(guild.id, BOT_ROLE.key, role.id);

  if (me.roles.cache.has(role.id)) return { role, wearer: me, error: null };

  try {
    // roles.add trả về member đã cập nhật — đọc luôn từ đó, khỏi đợi gateway.
    const wearer = await me.roles.add(role.id, 'Màu tên cho chính bot');
    return { role, wearer, error: null };
  } catch (err) {
    return { role, wearer: me, error: err.message };
  }
}

/**
 * Bot chỉ gán được role nằm THẤP HƠN role cao nhất của chính nó.
 * Đây là lỗi hay gặp nhất nên tách hẳn ra để /setup nói thẳng cho người dùng.
 */
export function rankRoleProblems(guild) {
  const me = guild.members.me;
  if (!me) return ['Không đọc được thông tin của chính bot trong server.'];

  const problems = [];
  if (!me.permissions.has('ManageRoles')) {
    problems.push('Bot thiếu quyền **Manage Roles**.');
  }

  const top = me.roles.highest.position;
  const blocked = RANKS.map((r) => guild.roles.cache.get(getRankRoleId(guild.id, r.key)))
    .filter((role) => role && role.position >= top)
    .map((role) => role.name);

  if (blocked.length) {
    problems.push(
      `Role của bot đang nằm **dưới** ${blocked.join(', ')}. ` +
        'Vào Server Settings → Roles và kéo role của bot lên trên các role cấp bậc.',
    );
  }
  return problems;
}

/**
 * Đồng bộ role cấp bậc cho một thành viên theo XP hiện tại.
 * Trả { promoted, rank } — promoted=true khi vừa lên cấp mới.
 */
export async function syncRank(guild, userId, xp, previousKey) {
  const rank = rankFor(xp);
  const promoted = Boolean(rank) && rank.key !== previousKey;

  if (!rank) return { promoted: false, rank: null };

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { promoted: false, rank };

  const targetId = getRankRoleId(guild.id, rank.key);
  if (!targetId) return { promoted: false, rank };

  // Giữ đúng một role cấp bậc: bỏ hết cấp cũ rồi gán cấp hiện tại.
  const staleIds = RANKS.filter((r) => r.key !== rank.key)
    .map((r) => getRankRoleId(guild.id, r.key))
    .filter((id) => id && member.roles.cache.has(id));

  try {
    if (staleIds.length) await member.roles.remove(staleIds, 'Lên cấp bậc mới');
    if (!member.roles.cache.has(targetId)) {
      await member.roles.add(targetId, `Đạt ${rank.name}`);
    }
    setUserRank(guild.id, userId, rank.key);
    return { promoted, rank };
  } catch (err) {
    console.error(`[ranks] không gán được role cho ${userId}:`, err.message);
    return { promoted: false, rank };
  }
}
