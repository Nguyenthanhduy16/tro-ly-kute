import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logicalDate } from '../dates.js';
import {
  countNotes,
  createNote,
  deleteNote,
  getGuildConfig,
  getNoteById,
  getNoteByNo,
  listNotes,
  noteTagRows,
  scanNotes,
  touchUser,
  updateNote,
} from '../db.js';
import {
  NOTE,
  deriveTitle,
  formatTags,
  matchNotes,
  noteEmbed,
  normalizeTags,
  notesEmbed,
  storedToTags,
  tagsToStored,
} from '../notes.js';
import { COLORS } from '../review.js';

const SCOPES = [
  { name: 'Của tôi', value: 'mine' },
  { name: 'Chia sẻ trong server', value: 'server' },
];

export const data = new SlashCommandBuilder()
  .setName('note')
  .setDescription('Ghi chép và tra lại những gì bạn học được')
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Lưu một ghi chú mới')
      .addStringOption((o) => o.setName('content').setDescription('Nội dung (bỏ trống để mở ô soạn nhiều dòng)'))
      .addStringOption((o) => o.setName('title').setDescription('Tiêu đề (bỏ trống thì lấy dòng đầu)'))
      .addStringOption((o) => o.setName('tags').setDescription('Tag, cách nhau bằng dấu phẩy: docker, ci-cd'))
      .addBooleanOption((o) => o.setName('share').setDescription('Cho cả server đọc (mặc định: riêng bạn)')),
  )
  .addSubcommand((s) =>
    s
      .setName('list')
      .setDescription('Danh sách ghi chú, mới nhất trước')
      .addStringOption((o) => o.setName('tag').setDescription('Chỉ lấy ghi chú có tag này').setAutocomplete(true))
      .addStringOption((o) => o.setName('scope').setDescription('Xem của ai').addChoices(...SCOPES))
      .addIntegerOption((o) => o.setName('page').setDescription('Trang').setMinValue(1))
      .addBooleanOption((o) => o.setName('public').setDescription('Hiện cho cả kênh thấy')),
  )
  .addSubcommand((s) =>
    s
      .setName('search')
      .setDescription('Tìm ghi chú theo từ khoá (không cần gõ dấu)')
      .addStringOption((o) => o.setName('query').setDescription('Từ khoá').setRequired(true))
      .addStringOption((o) => o.setName('tag').setDescription('Giới hạn trong một tag').setAutocomplete(true))
      .addStringOption((o) => o.setName('scope').setDescription('Tìm ở đâu').addChoices(...SCOPES))
      .addBooleanOption((o) => o.setName('public').setDescription('Hiện cho cả kênh thấy')),
  )
  .addSubcommand((s) =>
    s
      .setName('show')
      .setDescription('Đọc trọn một ghi chú')
      .addStringOption((o) =>
        o.setName('note').setDescription('Số hoặc tiêu đề ghi chú').setRequired(true).setAutocomplete(true),
      )
      .addBooleanOption((o) => o.setName('public').setDescription('Hiện cho cả kênh thấy')),
  )
  .addSubcommand((s) =>
    s
      .setName('edit')
      .setDescription('Sửa một ghi chú của bạn')
      .addStringOption((o) =>
        o.setName('note').setDescription('Số hoặc tiêu đề ghi chú').setRequired(true).setAutocomplete(true),
      )
      .addBooleanOption((o) => o.setName('share').setDescription('Đổi luôn chế độ chia sẻ')),
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Xoá một ghi chú của bạn')
      .addStringOption((o) =>
        o.setName('note').setDescription('Số hoặc tiêu đề ghi chú').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('tags')
      .setDescription('Các tag đang dùng và số ghi chú mỗi tag')
      .addStringOption((o) => o.setName('scope').setDescription('Đếm ở đâu').addChoices(...SCOPES)),
  );

/* -------------------------------------------------------------- tiện ích */

const hidden = (isPublic) => (isPublic ? {} : { flags: MessageFlags.Ephemeral });

function readable(interaction, note) {
  if (!note || note.guild_id !== interaction.guildId) return null;
  return note.user_id === interaction.user.id || note.shared ? note : null;
}

/** Ghi chú của bạn + ghi chú cả server đã chia sẻ, không trùng lặp. */
function candidates(interaction, ownOnly = false) {
  const base = { guildId: interaction.guildId, userId: interaction.user.id };
  const mine = scanNotes({ ...base, scope: 'mine' });
  if (ownOnly) return mine;
  const byId = new Map(mine.map((n) => [n.id, n]));
  for (const n of scanNotes({ ...base, scope: 'server' })) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()];
}

/**
 * Người dùng gõ gì cũng nhận: "#3", "3", một mẩu tiêu đề, hay giá trị `id:42`
 * do gợi ý trả về. Con số luôn hiểu là số ghi chú CỦA BẠN — đó là con số bot
 * hiển thị, không phải khoá nội bộ.
 */
function resolveNote(interaction, raw, { ownOnly = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const picked = text.match(/^id:(\d+)$/i);
  if (picked) return readable(interaction, getNoteById(Number(picked[1])));

  const numbered = text.match(/^#?(\d+)$/);
  if (numbered) return getNoteByNo(interaction.guildId, interaction.user.id, Number(numbered[1]));

  const [best] = matchNotes(candidates(interaction, ownOnly), text);
  return best ?? null;
}

function notFound(interaction, raw) {
  return interaction.reply({
    content:
      `Không tìm thấy ghi chú nào khớp \`${String(raw).slice(0, 80)}\`.\n` +
      'Gõ `/note list` để xem số của từng ghi chú, hoặc `/note search` để tìm theo từ khoá.',
    flags: MessageFlags.Ephemeral,
  });
}

async function authorOf(interaction, note) {
  if (note.user_id === interaction.user.id) {
    return {
      authorName: interaction.member?.displayName ?? interaction.user.username,
      authorIcon: interaction.user.displayAvatarURL(),
    };
  }
  const member = await interaction.guild.members.fetch(note.user_id).catch(() => null);
  return {
    authorName: member?.displayName ?? 'Thành viên đã rời server',
    authorIcon: member?.displayAvatarURL(),
  };
}

/* ---------------------------------------------------------------- ô soạn */

export function buildNoteModal({ customId, title, note, prefill = '' }) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  const titleInput = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Tiêu đề (bỏ trống thì lấy dòng đầu)')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(NOTE.title)
    .setRequired(false);

  const bodyInput = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Nội dung')
    .setPlaceholder('Học được gì, làm thế nào, link ở đâu — viết đủ để tháng sau đọc lại vẫn hiểu.')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(NOTE.body)
    .setRequired(true);

  const tagsInput = new TextInputBuilder()
    .setCustomId('tags')
    .setLabel(`Tag, cách nhau bằng dấu phẩy (tối đa ${NOTE.tags})`)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(120)
    .setRequired(false);

  if (note) {
    titleInput.setValue(note.title.slice(0, NOTE.title));
    bodyInput.setValue(note.body.slice(0, NOTE.body));
    const tags = storedToTags(note.tags);
    if (tags.length) tagsInput.setValue(tags.join(', '));
  } else if (prefill) {
    bodyInput.setValue(prefill.slice(0, NOTE.body));
  }

  return modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(bodyInput),
    new ActionRowBuilder().addComponents(tagsInput),
  );
}

/* -------------------------------------------------------------------- ghi */

/** Dùng chung cho `/note add`, ô soạn của nó, và menu chuột phải "Lưu vào ghi chú". */
export async function saveNote(interaction, { title, body, tags, shared, sourceUrl }) {
  const text = String(body ?? '').trim();
  if (!text) {
    return interaction.reply({ content: 'Ghi chú rỗng thì không lưu được.', flags: MessageFlags.Ephemeral });
  }

  // Ghi chú chia sẻ còn phải fetch kênh rồi đăng bài — giữ chỗ trước cho chắc.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const displayName = interaction.member?.displayName ?? interaction.user.username;
  touchUser(interaction.guildId, interaction.user.id, displayName);

  const note = createNote({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    title: (String(title ?? '').trim() || deriveTitle(text)).slice(0, NOTE.title),
    body: text.slice(0, NOTE.body),
    tags: tagsToStored(normalizeTags(tags)),
    shared,
    sourceUrl,
    date: logicalDate(),
  });

  const embed = noteEmbed(note, {
    authorName: displayName,
    authorIcon: interaction.user.displayAvatarURL(),
  }).setColor(COLORS.ok);

  const copyUrl = shared ? await postShared(interaction, embed) : null;

  return interaction.editReply({
    content:
      `✅ Đã lưu ghi chú \`#${note.no}\`. Đọc lại bất cứ lúc nào bằng \`/note show note:#${note.no}\`` +
      (copyUrl ? `\n🌐 Đã đăng cho cả server: ${copyUrl}` : ''),
    embeds: [embed],
  });
}

/** Ghi chú chia sẻ được đăng thêm một bản ra kênh chính — bản trong bot vẫn là bản gốc. */
async function postShared(interaction, embed) {
  const cfg = getGuildConfig(interaction.guildId);
  if (!cfg.channel_id) return null;
  const channel = await interaction.client.channels.fetch(cfg.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  return sent?.url ?? null;
}

/* --------------------------------------------------------------- lệnh con */

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'add') return addCommand(interaction);
  if (sub === 'list') return listCommand(interaction);
  if (sub === 'search') return searchCommand(interaction);
  if (sub === 'show') return showCommand(interaction);
  if (sub === 'edit') return editCommand(interaction);
  if (sub === 'delete') return deleteCommand(interaction);
  if (sub === 'tags') return tagsCommand(interaction);
  return undefined;
}

async function addCommand(interaction) {
  const content = interaction.options.getString('content');
  const shared = interaction.options.getBoolean('share') ?? false;

  // Không gõ nội dung ngay trên thanh lệnh -> mở ô soạn nhiều dòng.
  if (!content) {
    return interaction.showModal(
      buildNoteModal({ customId: `note:add:${shared ? 1 : 0}`, title: 'Ghi chú mới' }),
    );
  }

  return saveNote(interaction, {
    title: interaction.options.getString('title'),
    body: content,
    tags: interaction.options.getString('tags'),
    shared,
  });
}

function emptyEmbed(scope, tag) {
  return new EmbedBuilder()
    .setColor(COLORS.neutral)
    .setTitle('📚 Chưa có ghi chú nào')
    .setDescription(
      tag
        ? `Không có ghi chú nào mang tag \`#${tag}\`.`
        : scope === 'server'
          ? 'Chưa ai chia sẻ ghi chú nào. Thêm `share:True` khi lưu để cả server đọc được.'
          : 'Mở hàng bằng `/note add` — hoặc chuột phải vào một tin nhắn bất kỳ → **Apps → Lưu vào ghi chú**.',
    );
}

async function listCommand(interaction) {
  const scope = interaction.options.getString('scope') ?? 'mine';
  const tag = normalizeTags(interaction.options.getString('tag'))[0] ?? null;
  const page = interaction.options.getInteger('page') ?? 1;
  const isPublic = interaction.options.getBoolean('public') ?? false;

  const filter = { guildId: interaction.guildId, userId: interaction.user.id, scope, tag };
  const total = countNotes(filter);

  if (!total) {
    return interaction.reply({ embeds: [emptyEmbed(scope, tag)], flags: MessageFlags.Ephemeral });
  }

  const pages = Math.max(1, Math.ceil(total / NOTE.perPage));
  const safePage = Math.min(page, pages);
  const rows = listNotes({ ...filter, limit: NOTE.perPage, offset: (safePage - 1) * NOTE.perPage });

  const embed = notesEmbed({
    rows,
    viewerId: interaction.user.id,
    showOwner: scope === 'server',
    title: `📚 ${scope === 'server' ? 'Ghi chú chia sẻ' : 'Ghi chú của bạn'}${tag ? ` · #${tag}` : ''}`,
    footer:
      `${total} ghi chú · trang ${safePage}/${pages}` +
      (safePage < pages ? ` · xem tiếp: /note list page:${safePage + 1}` : ''),
  });

  return interaction.reply({ embeds: [embed], ...hidden(isPublic) });
}

async function searchCommand(interaction) {
  const query = interaction.options.getString('query');
  const scope = interaction.options.getString('scope') ?? 'mine';
  const tag = normalizeTags(interaction.options.getString('tag'))[0] ?? null;
  const isPublic = interaction.options.getBoolean('public') ?? false;

  const rows = matchNotes(
    scanNotes({ guildId: interaction.guildId, userId: interaction.user.id, scope, tag }),
    query,
  );

  if (!rows.length) {
    return interaction.reply({
      content:
        `Không có ghi chú nào khớp **${query}**${tag ? ` trong tag \`#${tag}\`` : ''}.\n` +
        'Tìm kiếm không phân biệt dấu và chữ hoa — thử bớt từ khoá lại xem.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const shown = rows.slice(0, NOTE.perPage);
  const embed = notesEmbed({
    rows: shown,
    query,
    viewerId: interaction.user.id,
    showOwner: scope === 'server',
    title: `🔎 ${rows.length} kết quả cho "${query}"`.slice(0, 256),
    footer:
      rows.length > shown.length
        ? `Đang hiện ${shown.length} kết quả hợp nhất · thêm từ khoá để thu hẹp`
        : 'Mở trọn nội dung: /note show note:<mã ở đầu mỗi dòng>',
  });

  return interaction.reply({ embeds: [embed], ...hidden(isPublic) });
}

async function showCommand(interaction) {
  const raw = interaction.options.getString('note');
  const note = resolveNote(interaction, raw);
  if (!note) return notFound(interaction, raw);

  // authorOf có thể phải hỏi Discord tên người viết -> giữ chỗ trước.
  const isPublic = interaction.options.getBoolean('public') ?? false;
  await interaction.deferReply(hidden(isPublic));
  const embed = noteEmbed(note, await authorOf(interaction, note));
  return interaction.editReply({ embeds: [embed] });
}

async function editCommand(interaction) {
  const raw = interaction.options.getString('note');
  const note = resolveNote(interaction, raw, { ownOnly: true });
  if (!note) return notFound(interaction, raw);
  if (note.user_id !== interaction.user.id) {
    return interaction.reply({ content: 'Chỉ sửa được ghi chú của chính bạn.', flags: MessageFlags.Ephemeral });
  }

  const share = interaction.options.getBoolean('share');
  const shareFlag = share === null ? 'keep' : String(Number(share));
  return interaction.showModal(
    buildNoteModal({
      customId: `note:edit:${note.id}:${shareFlag}`,
      title: `Sửa ghi chú #${note.no}`.slice(0, 45),
      note,
    }),
  );
}

async function deleteCommand(interaction) {
  const raw = interaction.options.getString('note');
  const note = resolveNote(interaction, raw, { ownOnly: true });
  if (!note) return notFound(interaction, raw);
  if (note.user_id !== interaction.user.id) {
    return interaction.reply({ content: 'Chỉ xoá được ghi chú của chính bạn.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Xoá là mất hẳn, nên hỏi lại một nhịp và cho thấy đúng thứ sắp mất.
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`note:del:${note.id}`)
      .setLabel(`Xoá #${note.no}`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('note:cancel').setLabel('Thôi').setStyle(ButtonStyle.Secondary),
  );

  return interaction.editReply({
    content: '⚠️ Xoá rồi là không khôi phục được. Xác nhận?',
    embeds: [noteEmbed(note, await authorOf(interaction, note)).setColor(COLORS.warn)],
    components: [row],
  });
}

function collectTagCounts(interaction, scope) {
  const counts = new Map();
  for (const row of noteTagRows({ guildId: interaction.guildId, userId: interaction.user.id, scope })) {
    for (const tag of storedToTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

async function tagsCommand(interaction) {
  const scope = interaction.options.getString('scope') ?? 'mine';
  const counts = collectTagCounts(interaction, scope);

  if (!counts.size) {
    return interaction.reply({
      content: 'Chưa có tag nào. Thêm `tags:` khi lưu ghi chú để sau này lọc lại cho nhanh.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([tag, n]) => `${formatTags([tag])} — ${n} ghi chú`);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`🏷️ Tag ${scope === 'server' ? 'chia sẻ trong server' : 'của bạn'}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Lọc theo tag: /note list tag:<tên>' }),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/* ----------------------------------------------------------- ô soạn gửi */

export const modalPrefix = 'note';

export async function handleModal(interaction) {
  const [, action, arg, shareFlag] = interaction.customId.split(':');
  const title = interaction.fields.getTextInputValue('title');
  const body = interaction.fields.getTextInputValue('body');
  const tags = interaction.fields.getTextInputValue('tags');

  if (action === 'add') {
    return saveNote(interaction, { title, body, tags, shared: arg === '1' });
  }

  if (action === 'edit') {
    const note = getNoteById(Number(arg));
    if (!note || note.user_id !== interaction.user.id || note.guild_id !== interaction.guildId) {
      return interaction.reply({ content: 'Ghi chú không còn nữa.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const updated = updateNote(note.id, {
      title: (title.trim() || deriveTitle(body)).slice(0, NOTE.title),
      body: body.trim().slice(0, NOTE.body),
      tags: tagsToStored(normalizeTags(tags)),
      shared: shareFlag === 'keep' ? note.shared : shareFlag === '1',
    });
    return interaction.editReply({
      content: `✏️ Đã cập nhật ghi chú \`#${updated.no}\`.`,
      embeds: [noteEmbed(updated, await authorOf(interaction, updated))],
    });
  }

  return undefined;
}

/* -------------------------------------------------------------- nút bấm */

export const buttonPrefix = 'note';

export async function handleButton(interaction) {
  const [, action, arg] = interaction.customId.split(':');

  if (action === 'cancel') {
    return interaction.update({ content: 'Đã huỷ, ghi chú vẫn còn nguyên.', embeds: [], components: [] });
  }

  if (action === 'del') {
    const note = getNoteById(Number(arg));
    if (!note || note.user_id !== interaction.user.id || note.guild_id !== interaction.guildId) {
      return interaction.update({ content: 'Ghi chú không còn nữa.', embeds: [], components: [] });
    }
    deleteNote(note.id);
    return interaction.update({
      content: `🗑️ Đã xoá ghi chú \`#${note.no}\` — **${note.title}**.`,
      embeds: [],
      components: [],
    });
  }

  return undefined;
}

/* --------------------------------------------------------- gợi ý khi gõ */

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'tag') return autocompleteTag(interaction, focused.value);
  return autocompleteNote(interaction, focused.value);
}

async function autocompleteTag(interaction, typed) {
  const scope = interaction.options.getString('scope') ?? 'mine';
  const needle = normalizeTags(typed)[0] ?? '';
  const choices = [...collectTagCounts(interaction, scope).entries()]
    .filter(([tag]) => tag.includes(needle))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map(([tag, n]) => ({ name: `#${tag} (${n})`, value: tag }));
  return interaction.respond(choices);
}

async function autocompleteNote(interaction, typed) {
  // Sửa và xoá chỉ đụng được ghi chú của mình, nên đừng gợi ý thứ không bấm được.
  const ownOnly = interaction.options.getSubcommand() !== 'show';
  const rows = matchNotes(candidates(interaction, ownOnly), typed).slice(0, 25);
  return interaction.respond(
    rows.map((n) => ({ name: `#${n.no} · ${n.title}`.slice(0, 100), value: `id:${n.id}` })),
  );
}
