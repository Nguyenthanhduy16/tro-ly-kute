import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { calendarDate, hourOfDay } from '../dates.js';
import {
  createReminder,
  deleteReminder,
  getGuildConfig,
  getReminderById,
  getReminderByNo,
  listReminders,
  setReminderDone,
  touchUser,
} from '../db.js';
import { fold } from '../notes.js';
import {
  REMIND,
  dueLabel,
  momentKey,
  parseWhen,
  reminderMoments,
  relativeLabel,
  remindersEmbed,
} from '../reminders.js';
import { COLORS } from '../review.js';

export const data = new SlashCommandBuilder()
  .setName('remind')
  .setDescription('Hẹn bot nhắc bạn khi một việc sắp tới hạn')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Thêm một việc có hạn')
      .addStringOption((o) =>
        o.setName('what').setDescription('Việc gì').setRequired(true).setMaxLength(REMIND.what),
      )
      .addStringOption((o) =>
        o
          .setName('when')
          .setDescription('Hạn: mai · t5 · 15/9 · +3 · 2026-09-15')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addIntegerOption((o) =>
        o.setName('hour').setDescription('Giờ trong ngày (0-23), bỏ trống thì nhắc cùng giờ nhắc daily')
          .setMinValue(0)
          .setMaxValue(23),
      )
      .addIntegerOption((o) =>
        o.setName('lead').setDescription('Báo trước mấy ngày (mặc định 1, 0 = chỉ nhắc đúng hôm đó)')
          .setMinValue(0)
          .setMaxValue(REMIND.maxLead),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('Những việc đang treo, gần tới hạn nhất trước')
      .addBooleanOption((o) => o.setName('all').setDescription('Xem cả những việc đã xong')),
  )
  .addSubcommand((s) =>
    s
      .setName('done')
      .setDescription('Đánh dấu đã xong, bot thôi nhắc')
      .addStringOption((o) =>
        o.setName('task').setDescription('Số hoặc tên việc').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Xoá hẳn một lời hẹn')
      .addStringOption((o) =>
        o.setName('task').setDescription('Số hoặc tên việc').setRequired(true).setAutocomplete(true),
      ),
  );

/* -------------------------------------------------------------- tiện ích */

function ownReminders(interaction, includeDone = true) {
  return listReminders({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    includeDone,
    limit: 100,
  });
}

/** Nhận "#3", "3", "id:42" do gợi ý trả về, hoặc một mẩu tên việc. */
function resolveReminder(interaction, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const picked = text.match(/^id:(\d+)$/i);
  if (picked) {
    const row = getReminderById(Number(picked[1]));
    return row && row.guild_id === interaction.guildId && row.user_id === interaction.user.id ? row : null;
  }

  const numbered = text.match(/^#?(\d+)$/);
  if (numbered) return getReminderByNo(interaction.guildId, interaction.user.id, Number(numbered[1]));

  const needle = fold(text);
  return ownReminders(interaction).find((r) => fold(r.what).includes(needle)) ?? null;
}

function notFound(interaction, raw) {
  return interaction.reply({
    content:
      `Không có lời hẹn nào khớp \`${String(raw).slice(0, 80)}\`.\n` +
      'Gõ `/remind list` để xem số của từng việc.',
    flags: MessageFlags.Ephemeral,
  });
}

/* --------------------------------------------------------------- lệnh con */

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') return addCommand(interaction);
  if (sub === 'list') return listCommand(interaction);
  if (sub === 'done') return doneCommand(interaction);
  if (sub === 'delete') return deleteCommand(interaction);
  return undefined;
}

const WHEN_HELP =
  'Hạn gõ được theo mấy kiểu này:\n' +
  '`mai` · `ngày kia` · `+3` · `3 ngày nữa`\n' +
  '`t5` · `thứ 5` · `chủ nhật` — lần kế tiếp\n' +
  '`15/9` · `15/09/2026` · `2026-09-15`';

async function addCommand(interaction) {
  const today = calendarDate();
  const raw = interaction.options.getString('when');
  const dueDate = parseWhen(raw, today);

  if (!dueDate) {
    return interaction.reply({
      content: `Không hiểu hạn \`${raw.slice(0, 60)}\`.\n\n${WHEN_HELP}`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (dueDate < today) {
    return interaction.reply({
      content: `\`${dueLabel(dueDate, null)}\` đã trôi qua rồi. Hẹn lùi về quá khứ thì bot không nhắc được.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const dueHour = interaction.options.getInteger('hour');
  const nowHour = hourOfDay();
  if (dueDate === today && dueHour !== null && dueHour <= nowHour) {
    return interaction.reply({
      content: `Bây giờ đã ${String(nowHour).padStart(2, '0')}:00 rồi, ${String(dueHour).padStart(2, '0')}:00 hôm nay qua mất. Đặt giờ muộn hơn hoặc đổi sang ngày khác.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const displayName = interaction.member?.displayName ?? interaction.user.username;
  touchUser(interaction.guildId, interaction.user.id, displayName);

  const cfg = getGuildConfig(interaction.guildId);
  const leadDays = interaction.options.getInteger('lead') ?? 1;
  const draft = { due_date: dueDate, due_hour: dueHour, lead_days: leadDays };
  const moments = reminderMoments(draft, cfg.remind_hour);

  // Mốc báo trước đã trôi qua ngay lúc tạo -> coi như đã bắn, đừng ping ngay
  // vào mặt người vừa gõ xong lệnh.
  const notifiedLead = momentKey(today, nowHour) >= moments.lead;

  const reminder = createReminder({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    what: interaction.options.getString('what').trim().slice(0, REMIND.what),
    dueDate,
    dueHour,
    leadDays,
    notifiedLead,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.ok)
    .setTitle(`⏰ Đã hẹn \`#${reminder.no}\``)
    .setDescription(`**${reminder.what}**\n${dueLabel(dueDate, dueHour)} · ${relativeLabel(dueDate, today)}`)
    .addFields({ name: 'Bot sẽ nhắc', value: scheduleLine({ notifiedLead, leadDays, dueHour, cfg }) });

  if (!cfg.channel_id) {
    embed.addFields({
      name: '⚠️ Chưa có kênh để nhắc',
      value: 'Server chưa chạy `/setup set channel:#kênh` nên tới hạn bot không biết nhắc ở đâu.',
    });
    embed.setColor(COLORS.warn);
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

function scheduleLine({ notifiedLead, leadDays, dueHour, cfg }) {
  const remindClock = `${String(cfg.remind_hour).padStart(2, '0')}:00`;
  const dueClock = dueHour === null ? remindClock : `${String(dueHour).padStart(2, '0')}:00`;
  const lines = [];

  if (leadDays > 0 && !notifiedLead) {
    lines.push(`• Báo trước **${leadDays} ngày**, lúc ${remindClock}`);
  } else if (leadDays > 0) {
    lines.push(`• Mốc báo trước ${leadDays} ngày đã qua — bỏ qua`);
  }
  lines.push(`• Đúng hôm tới hạn, lúc ${dueClock}`);
  return lines.join('\n');
}

async function listCommand(interaction) {
  const includeDone = interaction.options.getBoolean('all') ?? false;
  const today = calendarDate();
  const rows = listReminders({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    includeDone,
    limit: REMIND.perPage,
  });

  if (!rows.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setTitle('⏰ Không có việc nào đang treo')
          .setDescription('Hẹn một cái bằng `/remind add what:... when:mai`.'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const overdue = rows.filter((r) => !r.done && r.due_date < today).length;
  const embed = remindersEmbed({
    rows,
    today,
    title: includeDone ? '⏰ Tất cả lời hẹn' : '⏰ Việc đang treo',
    footer: overdue ? `${overdue} việc đã quá hạn` : 'Xong việc nào thì /remind done task:#<số>',
  });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function doneCommand(interaction) {
  const raw = interaction.options.getString('task');
  const reminder = resolveReminder(interaction, raw);
  if (!reminder) return notFound(interaction, raw);

  const updated = setReminderDone(reminder.id, !reminder.done);
  return interaction.reply({
    content: updated.done
      ? `✅ Xong \`#${updated.no}\` — **${updated.what}**. Bot thôi nhắc.`
      : `↩️ Mở lại \`#${updated.no}\` — **${updated.what}**. Bot nhắc tiếp.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function deleteCommand(interaction) {
  const raw = interaction.options.getString('task');
  const reminder = resolveReminder(interaction, raw);
  if (!reminder) return notFound(interaction, raw);

  deleteReminder(reminder.id);
  return interaction.reply({
    content: `🗑️ Đã xoá lời hẹn \`#${reminder.no}\` — **${reminder.what}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

/* --------------------------------------------------------- gợi ý khi gõ */

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'when') return autocompleteWhen(interaction, focused.value);
  return autocompleteTask(interaction, focused.value);
}

const WHEN_SHORTCUTS = ['hôm nay', 'mai', 'ngày kia', '+7', 't2', 't5', 'cn'];

/**
 * Gợi ý cho ô hạn vừa là phím tắt, vừa là bản xem trước: gõ "15/9" là thấy ngay
 * "15/09/2026 (T3) — còn 6 ngày", sai thì biết ngay chứ không đợi bấm xong.
 * Giá trị gửi đi luôn là ISO nên phía sau khỏi đoán lại.
 */
async function autocompleteWhen(interaction, typed) {
  const today = calendarDate();
  const parsed = parseWhen(typed, today);

  const choices = [];
  if (parsed) {
    choices.push({ name: `${dueLabel(parsed, null)} — ${relativeLabel(parsed, today)}`, value: parsed });
  }

  for (const shortcut of WHEN_SHORTCUTS) {
    if (choices.length >= 25) break;
    const date = parseWhen(shortcut, today);
    if (!date || date === parsed) continue;
    choices.push({ name: `${shortcut} → ${dueLabel(date, null)}`, value: date });
  }

  return interaction.respond(choices);
}

async function autocompleteTask(interaction, typed) {
  const today = calendarDate();
  const needle = fold(typed);
  // Gợi ý cả việc đã xong: /remind done bấm lần nữa là mở lại, /remind delete thì dọn hẳn.
  const rows = ownReminders(interaction, true)
    .filter((r) => !needle || fold(r.what).includes(needle))
    .slice(0, 25);

  return interaction.respond(
    rows.map((r) => ({
      name: `#${r.no} · ${r.what} — ${relativeLabel(r.due_date, today)}`.slice(0, 100),
      value: `id:${r.id}`,
    })),
  );
}
