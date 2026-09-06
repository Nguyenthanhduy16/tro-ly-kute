import { config } from './config.js';
import { addDays, isRequiredDay, previousExpectedDay } from './dates.js';

export const XP = {
  BASE_DAILY: 10,
  MAX_QUALITY: 5,
  NEXT_PLAN: 2,
  BLOCKER_HONESTY: 1,
  ON_TIME: 3,
  MAX_STREAK_BONUS: 10,
  WEEKLY_PLAN: 25,
};

/**
 * Streak = số ngày-bắt-buộc liên tiếp gần nhất có báo cáo.
 * Tính lại từ dữ liệu mỗi lần gọi nên không bao giờ lệch state.
 * Ngày cuối tuần (khi streakMode='weekdays') được bỏ qua chứ không làm đứt chuỗi.
 */
export function computeStreak(reportedDates, today) {
  const set = reportedDates instanceof Set ? reportedDates : new Set(reportedDates);
  let cursor = set.has(today) ? today : previousExpectedDay(today);
  let streak = 0;

  for (let guard = 0; guard < 3650; guard += 1) {
    if (set.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    } else if (!isRequiredDay(cursor)) {
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * XP cho một báo cáo daily. Thưởng cho việc viết cụ thể, có kế hoạch tiếp theo,
 * dám nêu vướng mắc, nộp đúng hạn và duy trì chuỗi.
 */
export function scoreDaily({ done, nextPlan, blocker, streak, onTime }) {
  const doneLen = (done ?? '').trim().length;
  const quality = clamp(Math.floor((doneLen - config.minDoneLength) / 60), 0, XP.MAX_QUALITY);
  const planned = (nextPlan ?? '').trim().length >= 20 ? XP.NEXT_PLAN : 0;
  const honest = (blocker ?? '').trim().length >= 10 ? XP.BLOCKER_HONESTY : 0;
  const punctual = onTime ? XP.ON_TIME : 0;
  const chain = clamp(streak, 0, XP.MAX_STREAK_BONUS);

  const breakdown = {
    base: XP.BASE_DAILY,
    quality,
    nextPlan: planned,
    blocker: honest,
    onTime: punctual,
    streak: chain,
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

/** Level tăng dần chậm: cần ~40 XP cho level 2, ~360 cho level 4, ~1000 cho level 6. */
export function levelOf(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;
}

export function levelProgress(xp) {
  const level = levelOf(xp);
  const xpForLevel = (l) => 40 * (l - 1) ** 2;
  const floorXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  return { level, into: xp - floorXp, need: nextXp - floorXp, nextAt: nextXp };
}

export function streakBadge(streak) {
  if (streak >= 60) return '🏆';
  if (streak >= 30) return '💎';
  if (streak >= 14) return '🔥';
  if (streak >= 7) return '⚡';
  if (streak >= 3) return '✨';
  if (streak >= 1) return '🌱';
  return '💤';
}

export function progressBar(into, need, width = 12) {
  const ratio = need > 0 ? clamp(into / need, 0, 1) : 0;
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
