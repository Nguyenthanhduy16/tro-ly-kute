import { config } from './config.js';

const TZ = config.timezone;

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  hour12: false,
});

/** 'YYYY-MM-DD' theo múi giờ cấu hình (chưa áp dụng rollover). */
export function calendarDate(when = new Date()) {
  return dateFmt.format(when);
}

/** Giờ (0-23) theo múi giờ cấu hình. */
export function hourOfDay(when = new Date()) {
  return Number(hourFmt.format(when));
}

/**
 * "Ngày làm việc" của một thời điểm: báo cáo lúc 1h sáng vẫn thuộc về hôm trước.
 * Đây là ngày dùng cho streak, dedupe báo cáo và thống kê tuần.
 */
export function logicalDate(when = new Date()) {
  const iso = calendarDate(when);
  return hourOfDay(when) < config.dayRolloverHour ? addDays(iso, -1) : iso;
}

function toUTCNoon(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

export function addDays(iso, delta) {
  const d = toUTCNoon(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 0 = Chủ nhật ... 6 = Thứ bảy */
export function weekdayOf(iso) {
  return toUTCNoon(iso).getUTCDay();
}

export function isWeekend(iso) {
  const d = weekdayOf(iso);
  return d === 0 || d === 6;
}

/** Thứ Hai của tuần chứa `iso`. */
export function weekStartOf(iso) {
  const d = weekdayOf(iso);
  const backToMonday = d === 0 ? 6 : d - 1;
  return addDays(iso, -backToMonday);
}

/** Danh sách 7 ngày của tuần bắt đầu từ `monday`. */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function dayLabel(iso) {
  return DAY_LABELS[weekdayOf(iso)];
}

/** '06/09 (T7)' */
export function prettyDate(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m} (${dayLabel(iso)})`;
}

/** '01/09 → 07/09/2025' */
export function prettyRange(startIso, endIso) {
  const [y] = endIso.split('-');
  const s = startIso.split('-');
  const e = endIso.split('-');
  return `${s[2]}/${s[1]} → ${e[2]}/${e[1]}/${y}`;
}

/** Ngày trước đó mà streak "kỳ vọng" phải có báo cáo (bỏ qua T7/CN nếu streakMode=weekdays). */
export function previousExpectedDay(iso) {
  let cursor = addDays(iso, -1);
  if (config.streakMode === 'weekdays') {
    while (isWeekend(cursor)) cursor = addDays(cursor, -1);
  }
  return cursor;
}

/** Ngày này có bắt buộc báo cáo không? */
export function isRequiredDay(iso) {
  return config.streakMode === 'everyday' || !isWeekend(iso);
}
