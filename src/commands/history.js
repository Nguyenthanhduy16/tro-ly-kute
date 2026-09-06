import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { prettyDate } from '../dates.js';
import { listRecentDailies } from '../db.js';
import { COLORS } from '../review.js';

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Xem lại các báo cáo gần đây')
  .addUserOption((o) => o.setName('user').setDescription('Của ai (mặc định: bạn)'))
  .addIntegerOption((o) =>
    o.setName('count').setDescription('Số báo cáo muốn xem (1-15)').setMinValue(1).setMaxValue(15),
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const count = interaction.options.getInteger('count') ?? 7;
  const rows = listRecentDailies(interaction.guildId, target.id, count);
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const displayName = member?.displayName ?? target.username;

  if (!rows.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.neutral)
          .setDescription(`**${displayName}** chưa có báo cáo nào.`),
      ],
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: displayName, iconURL: target.displayAvatarURL() })
    .setTitle(`${rows.length} báo cáo gần nhất`);

  for (const row of rows) {
    const parts = [row.done.replace(/\s+/g, ' ').slice(0, 700)];
    if (row.blocker) parts.push(`⚠️ ${row.blocker.replace(/\s+/g, ' ').slice(0, 200)}`);
    embed.addFields({
      name: `${prettyDate(row.report_date)} · +${row.xp} XP`,
      value: parts.join('\n'),
    });
  }

  return interaction.reply({ embeds: [embed] });
}
