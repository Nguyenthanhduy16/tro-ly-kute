import { EmbedBuilder } from 'discord.js';
import { COLORS } from './review.js';

export const NOTE = {
  title: 100,
  body: 3800,
  tag: 24,
  tags: 5,
  perPage: 10,
};

/**
 * Bỏ dấu + hạ chữ thường để so khớp. Gõ "docker" phải ra "Docker",
 * gõ "hoc" phải ra "học" — người ta tìm lại ghi chú cũ chứ không thi chính tả.
 * NFD tách dấu ra thành ký tự tổ hợp; riêng "đ" là chữ riêng nên thay tay.
 */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

/** Cắt câu tìm kiếm thành các từ đã bỏ dấu. */
export function terms(query) {
  return fold(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Tag luôn được lưu ở dạng đã bỏ dấu, chữ thường, nối bằng gạch ngang:
 * "#Học tập" và "hoc-tap" là cùng một tag, không tạo ra hai nhánh chết.
 */
export function normalizeTags(raw) {
  const out = [];
  // Tách theo dấu phẩy, hoặc theo khoảng trắng đứng trước '#': cả "học tập, docker"
  // lẫn "#hoc-tap #docker" đều ra đúng hai tag, không ép người dùng nhớ một cú pháp.
  for (const piece of String(raw ?? '').split(/[,\n]+|\s+(?=#)/)) {
    const tag = fold(piece)
      .replace(/^#+/, '')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, NOTE.tag);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= NOTE.tags) break;
  }
  return out;
}

/** Lưu kèm dấu phẩy hai đầu để LIKE '%,docker,%' khớp trọn tag chứ không khớp một phần. */
export function tagsToStored(tags) {
  return tags.length ? `,${tags.join(',')},` : '';
}

export function storedToTags(stored) {
  return String(stored ?? '').split(',').filter(Boolean);
}

export function formatTags(tags) {
  return tags.map((t) => `\`#${t}\``).join(' ');
}

/** Không đặt tiêu đề thì lấy dòng đầu làm tiêu đề — vẫn hơn một danh sách toàn "(không tên)". */
export function deriveTitle(body) {
  const line = String(body ?? '')
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find(Boolean);
  if (!line) return 'Ghi chú';
  return line.length <= NOTE.title ? line : `${line.slice(0, NOTE.title - 1)}…`;
}

/**
 * Lọc và xếp hạng ghi chú theo câu tìm kiếm.
 * Phải khớp MỌI từ (tìm "docker volume" không trả về mọi ghi chú có chữ docker);
 * khớp ở tiêu đề nặng ký hơn ở tag, ở tag nặng hơn ở nội dung, hoà thì mới nhất trước.
 */
const WEIGHT = { title: 3, tags: 2, body: 1 };

export function matchNotes(rows, query) {
  const words = terms(query);
  if (!words.length) return rows;

  const scored = [];
  for (const row of rows) {
    const title = fold(row.title);
    const tags = fold(row.tags);
    const body = fold(row.body);
    let score = 0;
    let all = true;
    for (const word of words) {
      if (title.includes(word)) score += WEIGHT.title;
      else if (tags.includes(word)) score += WEIGHT.tags;
      else if (body.includes(word)) score += WEIGHT.body;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score || b.row.id - a.row.id);
  return scored.map((s) => s.row);
}

/** Đoạn nội dung quanh từ khoá đầu tiên tìm thấy, để danh sách kết quả nói được điều gì đó. */
export function snippet(body, query, max = 160) {
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;

  const [word] = terms(query);
  const at = word ? fold(flat).indexOf(word) : -1;
  if (at < 0) return `${flat.slice(0, max - 1)}…`;

  const from = Math.max(0, at - Math.floor(max / 3));
  const cut = flat.slice(from, from + max);
  return `${from > 0 ? '…' : ''}${cut}${from + max < flat.length ? '…' : ''}`;
}

/** '06/09/2025' — ghi chú sống lâu hơn báo cáo daily nên phải có năm. */
export function noteDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

export function noteEmbed(note, { authorName, authorIcon } = {}) {
  const tags = storedToTags(note.tags);
  const embed = new EmbedBuilder()
    .setColor(note.shared ? COLORS.info : COLORS.neutral)
    .setTitle(`📝 #${note.no} · ${note.title}`.slice(0, 256))
    .setDescription(note.body.slice(0, 4000));

  if (authorName) embed.setAuthor({ name: authorName, iconURL: authorIcon });

  const meta = [noteDate(note.note_date)];
  if (tags.length) meta.push(formatTags(tags));
  meta.push(note.shared ? '🌐 cả server đọc được' : '🔒 riêng bạn');
  if (note.updated_at !== note.created_at) meta.push('✏️ đã sửa');
  embed.addFields({ name: 'Thông tin', value: meta.join(' · ') });

  if (note.source_url) {
    embed.addFields({ name: 'Nguồn', value: `[tin nhắn gốc](${note.source_url})` });
  }

  return embed;
}

/**
 * Cách gọi tên một ghi chú trong danh sách — cũng chính là thứ dán thẳng được vào
 * `/note show note:`. Số `#3` là số riêng của từng người, nên ghi chú của người
 * khác phải hiện dạng `id:42` thì mới trỏ đúng chỗ.
 */
export function noteRef(note, viewerId) {
  return note.user_id === viewerId ? `#${note.no}` : `id:${note.id}`;
}

/** Một dòng gọn cho danh sách: đủ để nhận ra ghi chú nào là ghi chú nào. */
export function noteLine(note, { query = '', viewerId = null, showOwner = false } = {}) {
  const tags = storedToTags(note.tags);
  const head = `\`${noteRef(note, viewerId)}\` **${note.title}**`;
  const meta = [noteDate(note.note_date)];
  if (showOwner && note.user_id !== viewerId) meta.push(`<@${note.user_id}>`);
  if (tags.length) meta.push(formatTags(tags));
  return `${head} · ${meta.join(' · ')}\n${snippet(note.body, query)}`;
}

export function notesEmbed({ rows, title, footer, query = '', viewerId = null, showOwner = false }) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(title)
    .setDescription(
      rows.map((r) => noteLine(r, { query, viewerId, showOwner })).join('\n\n').slice(0, 4000),
    )
    .setFooter({ text: footer });
}
