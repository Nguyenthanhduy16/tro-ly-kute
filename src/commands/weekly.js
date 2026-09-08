import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { addDays, logicalDate, prettyRange, weekStartOf, weekdayOf } from '../dates.js';
import { addXp, getPlan, getUser, savePlan, touchUser } from '../db.js';
import { syncRank } from '../ranks.js';
import { XP } from '../xp.js';
import { COLORS, collectWeek, runWeeklyReview, weekStrip } from '../review.js';
import { isAiEnabled } from '../ai.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('weekly')
  .setDescription('Kế hoạch tuần và đánh giá cuối tuần')
  .addSubcommand((s) =>
    s
      .setName('plan')
      .setDescription('Nộp / sửa kế hoạch công việc cho một tuần')
      .addStringOption((o) =>
        o
          .setName('week')
          .setDescription('Tuần nào (mặc định: tuần sắp tới nếu đang cuối tuần)')
          .addChoices({ name: 'Tuần này', value: 'this' }, { name: 'Tuần sau', value: 'next' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('show')
      .setDescription('Xem kế hoạch tuần và tiến độ hiện tại')
      .addUserOption((o) => o.setName('user').setDescription('Xem của ai (mặc định: bạn)'))
      .addStringOption((o) =>
        o
          .setName('week')
          .setDescription('Tuần nào')
          .addChoices({ name: 'Tuần này', value: 'this' }, { name: 'Tuần trước', value: 'last' }),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('review')
      .setDescription('Trợ lý AI tổng hợp và nhận xét thẳng thắn về tuần của bạn')
      .addStringOption((o) =>
        o
          .setName('week')
          .setDescription('Tuần nào (mặc định: tuần trước)')
          .addChoices({ name: 'Tuần trước', value: 'last' }, { name: 'Tuần này', value: 'this' }),
      )
      .addUserOption((o) => o.setName('user').setDescription('Review cho ai (mặc định: bạn)')),
  );

function weekStartFromChoice(choice, fallback) {
  const thisWeek = weekStartOf(logicalDate());
  const value = choice ?? fallback;
  if (value === 'next') return addDays(thisWeek, 7);
  if (value === 'last') return addDays(thisWeek, -7);
  return thisWeek;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'plan') return planCommand(interaction);
  if (sub === 'show') return showCommand(interaction);
  return reviewCommand(interaction);
}

/* -------------------------------------------------------------- /weekly plan */

async function planCommand(interaction) {
  const dow = weekdayOf(logicalDate());
  const isWeekend = dow === 0 || dow === 6;
  const weekStart = weekStartFromChoice(interaction.options.getString('week'), isWeekend ? 'next' : 'this');
  const existing = getPlan(interaction.guildId, interaction.user.id, weekStart);
  return interaction.showModal(buildPlanModal(weekStart, existing));
}

export function buildPlanModal(weekStart, existing) {
  const input = new TextInputBuilder()
    .setCustomId('plan')
    .setLabel('Tuần này bạn cam kết làm xong những gì?')
    .setPlaceholder('Mỗi dòng một mục tiêu đo được. VD: Xong màn hình đăng nhập + viết test cho nó')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(30)
    .setMaxLength(1800)
    .setRequired(true);

  if (existing) input.setValue(existing.plan.slice(0, 1800));

  const modal = new ModalBuilder()
    .setCustomId(`weeklyplan:${weekStart}`)
    .setTitle(`Kế hoạch tuần ${prettyRange(weekStart, addDays(weekStart, 6))}`)
    .addComponents(new ActionRowBuilder().addComponents(input));

  return modal;
}

export const modalPrefix = 'weeklyplan';

export async function handleModal(interaction) {
  const weekStart = interaction.customId.split(':')[1] ?? weekStartOf(logicalDate());
  const plan = interaction.fields.getTextInputValue('plan').trim();
  const { guildId } = interaction;
  const userId = interaction.user.id;
  const displayName = interaction.member?.displayName ?? interaction.user.username;

  touchUser(guildId, userId, displayName);
  const existing = getPlan(guildId, userId, weekStart);
  const award = existing?.xp_awarded ? 0 : XP.WEEKLY_PLAN;

  savePlan(guildId, userId, weekStart, plan, 1); // xp_awarded chỉ ghi lúc INSERT đầu tiên

  // Ghi xong vào SQLite mới giữ chỗ: mất mạng thì kế hoạch vẫn còn, chỉ là không
  // thấy phản hồi. syncRank bên dưới gọi REST, dễ vượt 3 giây Discord cho phép.
  await interaction.deferReply();

  if (award) {
    const previousRank = getUser(guildId, userId)?.rank_key ?? null;
    addXp(guildId, userId, award);
    await syncRank(interaction.guild, userId, getUser(guildId, userId).xp, previousRank);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setAuthor({ name: displayName, iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`${existing ? '✏️ Đã cập nhật' : '📌 Đã chốt'} kế hoạch tuần ${prettyRange(weekStart, addDays(weekStart, 6))}`)
    .setDescription(plan.slice(0, 3000))
    .setFooter({
      text: award
        ? `+${award} XP · cuối tuần trợ lý sẽ đối chiếu cam kết này với thực tế`
        : 'Cuối tuần trợ lý sẽ đối chiếu cam kết này với thực tế',
    });

  return interaction.editReply({ embeds: [embed] });
}

/* -------------------------------------------------------------- /weekly show */

async function showCommand(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const weekStart = weekStartFromChoice(interaction.options.getString('week'), 'this');
  const week = collectWeek(interaction.guildId, target.id, weekStart);
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const displayName = member?.displayName ?? target.username;

  const embed = new EmbedBuilder()
    .setColor(week.plan ? COLORS.info : COLORS.warn)
    .setAuthor({ name: displayName, iconURL: target.displayAvatarURL() })
    .setTitle(`Kế hoạch tuần ${prettyRange(week.weekStart, week.weekEnd)}`)
    .setDescription(
      week.plan
        ? week.plan.slice(0, 3000)
        : '*Chưa có kế hoạch cho tuần này.* Dùng `/weekly plan` để chốt — không có cam kết thì cuối tuần không có gì để đối chiếu.',
    )
    .addFields(
      { name: 'Chuyên cần', value: `${weekStrip(week.days, week.dailies)}\n${week.stats.reported}/${week.stats.expected} ngày`, inline: true },
      { name: 'XP tuần', value: `+${week.stats.xpEarned}`, inline: true },
    );

  if (week.dailies.length) {
    embed.addFields({
      name: 'Đã làm trong tuần',
      value: week.dailies
        .map((d) => `**${d.report_date.slice(8)}/${d.report_date.slice(5, 7)}** ${d.done.replace(/\s+/g, ' ').slice(0, 120)}`)
        .join('\n')
        .slice(0, 1000),
    });
  }

  return interaction.reply({ embeds: [embed] });
}

/* ------------------------------------------------------------ /weekly review */

async function reviewCommand(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const weekStart = weekStartFromChoice(interaction.options.getString('week'), 'last');

  if (!isAiEnabled()) {
    return interaction.reply({
      content: `Chưa cấu hình \`${config.ai.keyEnvVar}\` nên trợ lý chưa nhận xét được. Lấy key ở ${config.ai.keyUrl} rồi thêm vào file \`.env\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  const { embed, error } = await runWeeklyReview({
    guildId: interaction.guildId,
    userId: target.id,
    weekStart,
    displayName: member?.displayName ?? target.username,
    avatarUrl: target.displayAvatarURL(),
  });

  const payload = { embeds: [embed] };
  if (error) payload.content = `⚠️ Không gọi được AI: ${error.message}`;
  return interaction.editReply(payload);
}
