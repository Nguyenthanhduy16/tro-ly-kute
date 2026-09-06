import { config } from './config.js';
import { getRankRoleId, heldRankKeys, listConfiguredGuilds } from './db.js';
import { RANK_BY_KEY } from './ranks.js';

/**
 * Discord không cho role đổi màu gradient hay lấp lánh nếu server chưa boost
 * (API trả 403 "Missing guild feature"). Cách duy nhất không tốn tiền là bot tự
 * đổi màu role theo nhịp — mắt người đọc ra như màu đang thở.
 *
 * Mỗi cấp có bảng màu riêng trong cùng một tông, nên màu chạy mà vẫn nhận ra cấp.
 */
export const SHIMMER_PALETTES = {
  mam: [0x57f287, 0x3ba55d, 0x7ce8a3],
  deu: [0x1abc9c, 0x11806a, 0x4fd8bc],
  ben: [0x3498db, 0x1f6fa8, 0x6bb9ec],
  kyluat: [0x9b59b6, 0x6e3a85, 0xc07fdb],
  thep: [0xf1c40f, 0xc29d0b, 0xffde4d],
  huyenthoai: [0xe74c3c, 0xb03026, 0xff7a6b],
};

let step = 0;

/** Màu kế tiếp của một cấp tại nhịp `at`. */
export function shimmerColor(rankKey, at) {
  const palette = SHIMMER_PALETTES[rankKey];
  if (!palette) return null;
  return palette[at % palette.length];
}

/**
 * Một nhịp: đổi màu những role đang thực sự có người đeo.
 * Bỏ qua cấp trống để không rác audit log và không tốn request vô ích.
 */
export async function shimmerTick(client, at = step) {
  let changed = 0;

  for (const guildCfg of listConfiguredGuilds()) {
    const held = heldRankKeys(guildCfg.guild_id);
    if (!held.length) continue;

    const guild = await client.guilds.fetch(guildCfg.guild_id).catch(() => null);
    if (!guild) continue;

    for (const rankKey of held) {
      if (!RANK_BY_KEY.has(rankKey)) continue;
      const color = shimmerColor(rankKey, at);
      const roleId = getRankRoleId(guildCfg.guild_id, rankKey);
      if (!color || !roleId) continue;

      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      if (!role || role.color === color) continue;

      await role.setColor(color, 'Hiệu ứng màu chạy theo cấp bậc').catch((err) => {
        console.error(`[shimmer] không đổi được màu ${rankKey}:`, err.message);
      });
      changed += 1;
    }
  }
  return changed;
}

/** Bật vòng lặp. SHIMMER_SECONDS=0 thì tắt hẳn, màu đứng yên như cũ. */
export function startShimmer(client) {
  const seconds = config.shimmerSeconds;
  if (!seconds) {
    console.log('[shimmer] tắt (SHIMMER_SECONDS=0)');
    return null;
  }

  const timer = setInterval(() => {
    step += 1;
    shimmerTick(client, step).catch((err) => console.error('[shimmer]', err));
  }, seconds * 1000);

  timer.unref?.();
  console.log(`[shimmer] đang chạy, đổi màu mỗi ${seconds}s`);
  return timer;
}
