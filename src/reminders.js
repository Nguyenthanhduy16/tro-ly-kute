import { EmbedBuilder } from 'discord.js';
import { addDays, dayLabel, weekdayOf } from './dates.js';
import { fold } from './notes.js';
import { COLORS } from './review.js';

export const REMIND = {
  what: 200,
  maxLead: 14,
  perPage: 10,
};

const WEEKDAY_WORDS = {
  cn: 0,
  't2': 1,
  't3': 2,
  't4': 3,
  't5': 4,
  't6': 5,
  't7': 6,
};

/** '2026-09-15' có thật không — chặn 31/02 và bạn của nó. */
function isRealDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function build(y, m, d) {
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isRealDate(iso) ? iso : null;
}

/** Ngày xảy ra thứ `target` lần kế tiếp, luôn là một ngày SAU hôm nay. */
function nextWeekday(today, target) {
  let cursor = addDays(today, 1);
  for (let i = 0; i < 7; i += 1) {
    if (weekdayOf(cursor) === target) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

/**
 * Người ta gõ hạn theo đủ kiểu. Nhận hết những kiểu hay gặp nhất, và luôn trả về
 * 'YYYY-MM-DD' hoặc null — không đoán bừa, gõ sai thì báo sai để còn gõ lại.
 *
 *   hôm nay · mai · ngày kia · +5 · 3 ngày nữa
 *   t3 · thứ 5 · chủ nhật          (lần kế tiếp, luôn là ngày sau hôm nay)
 *   15/9 · 15/09/2026 · 15-9-26 · 2026-09-15
 *
 * `dd/mm` không kèm năm mà đã trôi qua thì hiểu là năm sau — gõ "2/1" vào
 * cuối tháng 12 gần như chắc chắn là Tết chứ không phải mười một tháng trước.
 */
export function parseWhen(raw, today) {
  const text = fold(raw).trim().replace(/\s+/g, ' ');
  if (!text) return null;

  if (/^(hom nay|nay|today)$/.test(text)) return today;
  if (/^(mai|ngay mai|tomorrow)$/.test(text)) return addDays(today, 1);
  if (/^(ngay kia|ngay mot)$/.test(text)) return addDays(today, 2);

  // Tương đối: phải có dấu + hoặc chữ "ngày", để "15" vẫn hiểu là ngày 15.
  const rel = text.match(/^\+(\d{1,3})$/) ?? text.match(/^(\d{1,3}) ngay(?: nua)?$/);
  if (rel) return addDays(today, Number(rel[1]));

  const weekday = text.replace(/^thu /, 't').replace(/^chu nhat$/, 'cn').replace(/ /g, '');
  if (weekday in WEEKDAY_WORDS) return nextWeekday(today, WEEKDAY_WORDS[weekday]);

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return build(year, Number(dmy[2]), Number(dmy[1]));
  }

  const dm = text.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (dm) {
    const year = Number(today.slice(0, 4));
    const guess = build(year, Number(dm[2]), Number(dm[1]));
    if (!guess) return null;
    return guess >= today ? guess : build(year + 1, Number(dm[2]), Number(dm[1]));
  }

  return null;
}

/** Số ngày từ `from` tới `to`, âm nếu đã trôi qua. */
export function daysBetween(from, to) {
  const ms = new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`);
  return Math.round(ms / 86400000);
}

/** 'còn 3 ngày', 'ngày mai', 'hôm nay', 'quá hạn 2 ngày'. */
export function relativeLabel(dueDate, today) {
  const days = daysBetween(today, dueDate);
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'ngày mai';
  if (days === 2) return 'ngày kia';
  if (days > 0) return `còn ${days} ngày`;
  if (days === -1) return 'quá hạn hôm qua';
  return `quá hạn ${-days} ngày`;
}

/** '15/09/2026 (T3) 14:00' — có năm vì hạn thường nằm xa, có thứ vì hay phải nhẩm. */
export function dueLabel(dueDate, dueHour) {
  const [y, m, d] = dueDate.split('-');
  const clock = dueHour === null || dueHour === undefined ? '' : ` ${String(dueHour).padStart(2, '0')}:00`;
  return `${d}/${m}/${y} (${dayLabel(dueDate)})${clock}`;
}

/**
 * Mốc so sánh của một thời điểm: 'YYYY-MM-DD HH'. So chuỗi là đủ vì định dạng
 * đã xếp sẵn theo thứ tự — khỏi dựng Date rồi lo múi giờ lần nữa.
 */
export function momentKey(date, hour) {
  return `${date} ${String(hour).padStart(2, '0')}`;
}

/**
 * Hai mốc nhắc của một lời hẹn.
 * `remindHour` là giờ nhắc chung của server: dùng cho lần báo trước, và cho cả
 * lần tới hạn nếu lời hẹn không đặt giờ cụ thể.
 */
export function reminderMoments(reminder, remindHour) {
  const dueHour = reminder.due_hour ?? remindHour;
  return {
    lead: momentKey(addDays(reminder.due_date, -reminder.lead_days), remindHour),
    due: momentKey(reminder.due_date, dueHour),
  };
}

/** Lời hẹn nào tới lúc phải bắn, và bắn cái nào trong hai mốc. */
export function dueNotifications(reminders, remindHour, now) {
  const out = [];
  for (const r of reminders) {
    const { lead, due } = reminderMoments(r, remindHour);
    if (!r.notified_due && now >= due) out.push({ reminder: r, kind: 'due' });
    else if (!r.notified_lead && now >= lead && now < due) out.push({ reminder: r, kind: 'lead' });
  }
  return out;
}

export function reminderLine(r, today) {
  return `\`#${r.no}\` **${r.what}** · ${dueLabel(r.due_date, r.due_hour)} · ${relativeLabel(r.due_date, today)}`;
}

export function remindersEmbed({ rows, today, title, footer }) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(title)
    .setDescription(rows.map((r) => reminderLine(r, today)).join('\n').slice(0, 4000))
    .setFooter({ text: footer });
}

/** Tin nhắn bot bắn ra kênh khi tới lúc. */
export function notificationEmbed({ reminder, kind, today }) {
  const soon = kind === 'lead';
  return new EmbedBuilder()
    .setColor(soon ? COLORS.warn : COLORS.bad)
    .setTitle(soon ? `⏳ Sắp tới hạn — ${relativeLabel(reminder.due_date, today)}` : '🔔 Tới hạn hôm nay')
    .setDescription(
      `<@${reminder.user_id}>\n\n**${reminder.what}**\n${dueLabel(reminder.due_date, reminder.due_hour)}`,
    )
    .setFooter({ text: `Xong rồi thì gõ /remind done task:#${reminder.no}` });
}
