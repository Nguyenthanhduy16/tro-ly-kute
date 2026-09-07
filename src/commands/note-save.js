import { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } from 'discord.js';
import { NOTE } from '../notes.js';
import { buildNoteModal, saveNote } from './note.js';

/**
 * Menu chuột phải trên một tin nhắn bất kỳ: Apps → "Lưu vào ghi chú".
 * Đây là đường ngắn nhất cho đúng nỗi đau ban đầu — thứ hay ho vừa trôi qua
 * trong kênh thì vớt lại được ngay tại chỗ, không phải copy dán đi đâu.
 *
 * Lệnh context menu được Discord kèm sẵn nội dung tin nhắn người dùng chọn,
 * nên vẫn không cần bật privileged intent Message Content.
 */
export const data = new ContextMenuCommandBuilder()
  .setName('Lưu vào ghi chú')
  .setType(ApplicationCommandType.Message);

/** Chữ trong tin nhắn: nội dung, rồi tới embed, rồi tới link file đính kèm. */
export function messageText(message) {
  const parts = [];
  if (message.content?.trim()) parts.push(message.content.trim());

  for (const embed of message.embeds ?? []) {
    const chunk = [embed.title, embed.description, embed.url].filter(Boolean).join('\n');
    if (chunk) parts.push(chunk);
  }

  const files = [...(message.attachments?.values?.() ?? [])].map((a) => a.url);
  if (files.length) parts.push(files.join('\n'));

  return parts.join('\n\n').slice(0, NOTE.body);
}

export async function execute(interaction) {
  const message = interaction.targetMessage;
  const text = messageText(message);

  if (!text) {
    return interaction.reply({
      content: 'Tin nhắn này không có chữ nào để lưu (chỉ ảnh dán trực tiếp hoặc sticker).',
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.showModal(
    buildNoteModal({
      customId: `notesave:${message.channelId}:${message.id}`,
      title: 'Lưu vào ghi chú',
      prefill: text,
    }),
  );
}

export const modalPrefix = 'notesave';

export async function handleModal(interaction) {
  const [, channelId, messageId] = interaction.customId.split(':');
  return saveNote(interaction, {
    title: interaction.fields.getTextInputValue('title'),
    body: interaction.fields.getTextInputValue('body'),
    tags: interaction.fields.getTextInputValue('tags'),
    shared: false,
    sourceUrl: `https://discord.com/channels/${interaction.guildId}/${channelId}/${messageId}`,
  });
}
