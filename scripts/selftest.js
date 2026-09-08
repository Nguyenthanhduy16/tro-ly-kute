/**
 * Kiểm tra logic streak / XP / gom dữ liệu tuần mà không cần kết nối Discord.
 * Chạy: npm test
 */
process.env.DB_PATH = ':memory:';
process.env.TIMEZONE ||= 'Asia/Ho_Chi_Minh';
// Cố định cấu hình AI để test không phụ thuộc .env thật của máy đang chạy.
// dotenv không ghi đè biến đã tồn tại, nên gán ở đây là chốt.
process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = '';

const { computeStreak, scoreDaily, levelProgress, XP } = await import('../src/xp.js');
const { weekStartOf, previousExpectedDay } = await import('../src/dates.js');
const db = await import('../src/db.js');
const { collectWeek, weekStrip } = await import('../src/review.js');
const notes = await import('../src/notes.js');
const noteSave = await import('../src/commands/note-save.js');
const { messageText } = noteSave;
const note = await import('../src/commands/note.js');
const { MessageFlags } = await import('discord.js');
const { buildReviewPrompt } = await import('../src/ai.js');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : `\n     mong đợi ${JSON.stringify(expected)}, nhận ${JSON.stringify(actual)}`}`);
}

/* ------------------------------------------------------------------ dates */
// 2025-09-01 là thứ Hai, 2025-09-06 thứ Bảy, 2025-09-07 Chủ nhật.
check('weekStartOf(thứ 7) -> thứ 2 cùng tuần', weekStartOf('2025-09-06'), '2025-09-01');
check('weekStartOf(chủ nhật) -> thứ 2 cùng tuần', weekStartOf('2025-09-07'), '2025-09-01');
check('previousExpectedDay(thứ 2) bỏ qua cuối tuần', previousExpectedDay('2025-09-08'), '2025-09-05');

/* ----------------------------------------------------------------- streak */
const weekdayRun = ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04', '2025-09-05'];
check('5 ngày trong tuần liên tiếp', computeStreak(weekdayRun, '2025-09-05'), 5);
check('nghỉ T7/CN không làm đứt chuỗi', computeStreak(weekdayRun, '2025-09-08'), 5);
check('bỏ lỡ thứ 2 -> chuỗi về 0', computeStreak(weekdayRun, '2025-09-09'), 0);
check('bỏ lỡ giữa tuần -> chỉ tính đoạn cuối', computeStreak(['2025-09-01', '2025-09-04', '2025-09-05'], '2025-09-05'), 2);
check('chưa báo cáo hôm nay vẫn giữ chuỗi hôm qua', computeStreak(weekdayRun, '2025-09-08'), 5);
check('chưa có báo cáo nào', computeStreak([], '2025-09-05'), 0);

/* --------------------------------------------------------------------- XP */
const short = scoreDaily({ done: 'x'.repeat(40), nextPlan: '', blocker: '', streak: 0, onTime: false });
check('báo cáo tối thiểu = XP nền', short.total, XP.BASE_DAILY);

const rich = scoreDaily({
  done: 'x'.repeat(400),
  nextPlan: 'y'.repeat(30),
  blocker: 'z'.repeat(20),
  streak: 12,
  onTime: true,
});
check('báo cáo đầy đủ ăn trần thưởng', rich.breakdown, {
  base: 10,
  quality: 5,
  nextPlan: 2,
  blocker: 1,
  onTime: 3,
  streak: 10,
});
check('streak bonus bị chặn trần', rich.total, 31);
check('level 1 khi chưa có XP', levelProgress(0).level, 1);
check('level 4 tại 360 XP', levelProgress(360).level, 4);

/* ------------------------------------------------------- tích hợp với DB */
const G = 'guild-test';
const U = 'user-test';
db.touchUser(G, U, 'Người Thử Nghiệm');

const entries = [
  ['2025-09-01', 'Dựng xong schema SQLite cho bot và viết 6 bảng, chạy migration sạch.', 'Viết lệnh /daily', ''],
  ['2025-09-02', 'Xong lệnh /daily kèm modal nhiều dòng, validate tối thiểu 40 ký tự.', 'Làm streak', 'Discord modal chỉ cho 5 ô'],
  ['2025-09-04', 'Đọc tài liệu Gemini API, thử prompt review nhưng chưa ra kết quả ưng ý.', '', 'Chưa biết chỉnh prompt'],
];
for (const [date, done, next, blocker] of entries) {
  const streak = computeStreak([...db.listDailyDates(G, U), date], date);
  const { total } = scoreDaily({ done, nextPlan: next, blocker, streak, onTime: true });
  db.saveDaily({ guildId: G, userId: U, date, done, nextPlan: next, blocker, xp: total, onTime: true });
  db.addXp(G, U, total);
  db.recordBestStreak(G, U, streak);
}

check('lưu đủ 3 báo cáo', db.listDailyDates(G, U).length, 3);
check('ghi nhận kỷ lục streak', db.getUser(G, U).best_streak, 2);

db.savePlan(G, U, '2025-09-01', 'Xong bot Discord báo cáo daily.\nViết README.', 1);

// Cố định "hôm nay" = Chủ nhật 07/09 để tuần đã khép lại, đủ 5 ngày bắt buộc.
const week = collectWeek(G, U, '2025-09-01', '2025-09-07');
check('tuần có 3 báo cáo', week.stats.reported, 3);
check('tuần cần 5 ngày bắt buộc', week.stats.expected, 5);
check('bỏ lỡ thứ 4 và thứ 6', week.stats.missed, ['2025-09-03', '2025-09-05']);
check('có ngày nêu vướng mắc', week.stats.blockerDays, 2);
check('dải tuần hiển thị đúng', weekStrip(week.days, week.dailies, '2025-09-07'), '✅ ✅ ❌ ✅ ❌ ⬜ ⬜');
check('lấy được kế hoạch tuần', week.plan.startsWith('Xong bot Discord'), true);

const prompt = buildReviewPrompt({
  displayName: 'Người Thử Nghiệm',
  weekStart: week.weekStart,
  weekEnd: week.weekEnd,
  plan: week.plan,
  dailies: week.dailies,
  stats: week.stats,
});
check('prompt có phần kế hoạch', prompt.includes('Kế hoạch đã cam kết'), true);
check('prompt liệt kê ngày trống', prompt.includes('03/09'), true);

console.log('\n--- Prompt gửi cho Gemini (xem thử) ---\n');
console.log(prompt);
console.log('\n---------------------------------------\n');

/* ------------------------------------------------------------ cap bac / role */
const ranks = await import('../src/ranks.js');

check('0 XP chua co cap', ranks.rankFor(0), null);
check('39 XP van chua co cap', ranks.rankFor(39), null);
check('40 XP -> Mam', ranks.rankFor(40).key, 'mam');
check('159 XP van la Mam', ranks.rankFor(159).key, 'mam');
check('160 XP -> Deu dan', ranks.rankFor(160).key, 'deu');
check('1000 XP -> Thep', ranks.rankFor(1000).key, 'thep');
check('5000 XP van la cap dinh', ranks.rankFor(5000).key, 'huyenthoai');
check('nguong cac cap tang dan', ranks.RANKS.map(ranks.xpForRank), [40, 160, 360, 640, 1000, 1960]);
check('cap ke tiep tu 0 XP', [ranks.nextRank(0).rank.key, ranks.nextRank(0).missing], ['mam', 40]);
check('cap ke tiep tu 200 XP', [ranks.nextRank(200).rank.key, ranks.nextRank(200).missing], ['ben', 160]);
check('dat dinh thi khong con cap ke tiep', ranks.nextRank(5000), null);
check('moi cap mot mau rieng', new Set(ranks.RANKS.map((r) => r.color)).size, ranks.RANKS.length);

// Tao role: lan dau tao du 6, lan hai khong tao trung.
function fakeGuild({ canManage = true, botPosition = 100 } = {}) {
  const roles = new Map();
  let n = 0;
  const guild = {
    id: G,
    roles: {
      cache: roles,
      create: async ({ name, color }) => {
        const role = { id: `role-${++n}`, name, color, position: 10 };
        roles.set(role.id, role);
        return role;
      },
    },
    members: {
      me: {
        permissions: { has: (p) => (p === 'ManageRoles' ? canManage : true) },
        roles: { highest: { position: botPosition } },
      },
    },
  };
  roles.find = (fn) => [...roles.values()].find(fn);
  return guild;
}

{
  const guild = fakeGuild();
  const first = await ranks.ensureRankRoles(guild);
  check('tao du 6 role lan dau', [first.created.length, first.error], [6, null]);
  check('luu id role vao DB', Boolean(db.getRankRoleId(G, 'mam')), true);

  const second = await ranks.ensureRankRoles(guild);
  check('goi lai khong tao role trung', [second.created.length, second.existing.length], [0, 6]);
  check('khong co van de ve quyen', ranks.rankRoleProblems(guild), []);
}

{
  const guild = fakeGuild({ canManage: false });
  await ranks.ensureRankRoles(guild);
  check('thieu quyen -> bao Manage Roles', ranks.rankRoleProblems(guild)[0].includes('Manage Roles'), true);
}

{
  // Role bot nam duoi role cap bac -> Discord se tu choi gan.
  const guild = fakeGuild({ botPosition: 5 });
  await ranks.ensureRankRoles(guild);
  const problems = ranks.rankRoleProblems(guild);
  check('role bot qua thap -> canh bao thu tu', problems.some((p) => p.includes('kéo role của bot lên trên')), true);
}

/* ------------------------------------------------------------ hieu ung mau chay */
const shimmer = await import('../src/shimmer.js');

check('moi cap deu co bang mau', ranks.RANKS.every((r) => shimmer.SHIMMER_PALETTES[r.key]?.length >= 3), true);
check('mau dau bang trung mau goc cua cap', ranks.RANKS.every((r) => shimmer.SHIMMER_PALETTES[r.key][0] === r.color), true);
check('mau lap lai theo chu ky', shimmer.shimmerColor('ben', 0), shimmer.shimmerColor('ben', 3));
check('nhip ke tiep doi mau', shimmer.shimmerColor('ben', 0) !== shimmer.shimmerColor('ben', 1), true);
check('cap khong ton tai -> khong co mau', shimmer.shimmerColor('khong-co', 0), null);
check('bot co bang mau rieng', shimmer.SHIMMER_PALETTES[ranks.BOT_ROLE.key][0], ranks.BOT_ROLE.color);

// Chi doi mau cap dang co nguoi deo: khong ai deo -> khong request nao.
{
  db.updateGuildConfig(G, { channel_id: 'chan-1' });
  const calls = [];
  const fakeClient = {
    guilds: {
      fetch: async () => ({
        roles: {
          cache: new Map(),
          fetch: async (id) => ({ id, color: 0, setColor: async (c) => calls.push([id, c]) }),
        },
      }),
    },
  };

  check('chua ai co cap -> khong doi mau role nao', await shimmer.shimmerTick(fakeClient, 1), 0);

  db.setUserRank(G, U, 'ben');
  check('co nguoi deo -> doi dung 1 role', await shimmer.shimmerTick(fakeClient, 1), 1);
  check('doi sang dung mau cua nhip do', calls[0][1], shimmer.shimmerColor('ben', 1));
  db.setUserRank(G, U, null);

  // Role mau cua chinh bot chay doc lap, khong phu thuoc co ai dat cap hay chua.
  db.saveRankRoleId(G, ranks.BOT_ROLE.key, 'role-bot');
  calls.length = 0;
  check('chua ai co cap nhung bot van doi mau', await shimmer.shimmerTick(fakeClient, 1), 1);
  check('bot doi theo bang mau cua no', calls[0][1], shimmer.shimmerColor(ranks.BOT_ROLE.key, 1));
}

/* ------------------------------------------- modal & embed hợp lệ với Discord */
const { buildModal } = await import('../src/commands/daily.js');
const { buildPlanModal } = await import('../src/commands/weekly.js');
const { buildReviewEmbed } = await import('../src/review.js');

const dailyModal = buildModal('2025-09-06', db.getDaily(G, U, '2025-09-02')).toJSON();
check('modal daily có 3 ô nhập', dailyModal.components.length, 3);
check('tiêu đề modal daily <= 45 ky tu', dailyModal.title.length <= 45, true);
for (const row of dailyModal.components) {
  const input = row.components[0];
  check(`  o "${input.custom_id}": label <= 45`, input.label.length <= 45, true);
  check(`  o "${input.custom_id}": placeholder <= 100`, (input.placeholder ?? '').length <= 100, true);
}

const planModal = buildPlanModal('2025-09-08', null).toJSON();
check('tieu de modal plan <= 45 ky tu', planModal.title.length <= 45, true);
check('placeholder plan <= 100 ky tu', planModal.components[0].components[0].placeholder.length <= 100, true);

const longReview = 'Nhan xet rat dai. '.repeat(400);
const reviewEmbed = buildReviewEmbed({
  displayName: 'Nguoi Thu Nghiem',
  avatarUrl: null,
  week,
  reviewText: longReview,
  score: 6.5,
}).toJSON();
check('mo ta embed bi cat <= 4096', reviewEmbed.description.length <= 4096, true);
check('moi field embed <= 1024', reviewEmbed.fields.every((f) => f.value.length <= 1024), true);
check('embed co footer diem', reviewEmbed.footer.text.includes('6.5/10'), true);

/* ------------------------------------------------ Discord gia lap (kenh + thread) */
const { _internals } = await import('../src/scheduler.js');
const { ensureDayThread, dayDestination } = await import('../src/threads.js');

function fakeDiscord() {
  const sent = [];
  const threads = new Map();
  let n = 0;
  const msg = () => ({ id: `msg-${++n}`, url: `https://discord.test/msg-${n}` });

  const channel = {
    id: 'chan-1',
    isTextBased: () => true,
    isThread: () => false,
    send: async (p) => (sent.push({ where: 'channel', ...p }), msg()),
    threads: {
      create: async ({ name }) => {
        const id = `thread-${threads.size + 1}`;
        const t = {
          id,
          name,
          archived: false,
          isTextBased: () => true,
          isThread: () => true,
          setArchived: async (v) => { t.archived = v; },
          send: async (p) => (sent.push({ where: id, ...p }), msg()),
          messages: { fetch: async () => { throw new Error('khong co'); } },
        };
        threads.set(id, t);
        return t;
      },
    },
  };

  const client = {
    channels: {
      fetch: async (id) => {
        if (id === 'chan-1') return channel;
        const t = threads.get(id);
        if (t) return t;
        throw new Error('khong tim thay kenh');
      },
    },
    guilds: { fetch: async () => ({ members: { fetch: async () => null } }) },
  };
  return { client, sent, threads, channel };
}

db.updateGuildConfig(G, { channel_id: 'chan-1' });

/* --------------------------------------------------------------- thread */
{
  const { client, threads } = fakeDiscord();
  const cfg = db.getGuildConfig(G);

  const t1 = await ensureDayThread(client, cfg, '2025-09-03');
  check('tao thread cho ngay moi', t1?.name, '📅 03/09 (T4)');
  check('nho id thread vao DB', db.getDayThreadId(G, '2025-09-03'), t1.id);

  const t2 = await ensureDayThread(client, cfg, '2025-09-03');
  check('goi lai khong tao thread trung', threads.size, 1);
  check('dung lai dung thread cu', t2.id, t1.id);

  const t3 = await ensureDayThread(client, cfg, '2025-09-04');
  check('ngay khac -> thread khac', t3.id !== t1.id, true);

  t1.archived = true;
  const t4 = await ensureDayThread(client, cfg, '2025-09-03');
  check('thread bi luu tru thi mo lai', t4.archived, false);
}

/* ------------------------------------------------- tat che do thread */
{
  const { client } = fakeDiscord();
  db.updateGuildConfig(G, { use_threads: 0 });
  const cfg = db.getGuildConfig(G);
  check('tat threads -> khong tao thread', await ensureDayThread(client, cfg, '2025-09-05'), null);
  const dest = await dayDestination(client, cfg, '2025-09-05');
  check('tat threads -> lui ve kenh', [dest.isThread, dest.target.id], [false, 'chan-1']);
  db.updateGuildConfig(G, { use_threads: 1 });
}

/* ------------------------------- thread loi (thieu quyen) -> lui ve kenh */
{
  const { client, channel } = fakeDiscord();
  channel.threads.create = async () => { throw new Error('Missing Permissions'); };
  const dest = await dayDestination(client, db.getGuildConfig(G), '2025-09-06');
  check('tao thread that bai -> van dang duoc ra kenh', [dest.isThread, dest.target.id], [false, 'chan-1']);
}

/* --------------------------------------------------------- nhac nho */
{
  const { client, sent } = fakeDiscord();
  const cfg = db.getGuildConfig(G);

  await _internals.sendDailyReminder(client, cfg, { lastCall: false, today: '2025-09-03' });
  check('gui dung 1 loi nhac', sent.length, 1);
  check('loi nhac nam trong thread cua ngay', sent[0].where.startsWith('thread-'), true);
  check('loi nhac ping dung user', sent[0].embeds[0].data.description.includes(`<@${U}>`), true);

  sent.length = 0;
  await _internals.sendDailyReminder(client, cfg, { lastCall: false, today: '2025-09-02' });
  check('da bao cao thi khong bi ping', sent[0].embeds[0].data.description.includes('@'), false);

  sent.length = 0;
  await _internals.sendDailyReminder(client, cfg, { lastCall: false, today: '2025-09-07' });
  check('cuoi tuan khong bi nhac', sent.length, 0);
}

/* ------------------------------------------- nhac cuoi tuan (khong phat streak) */
{
  db.updateGuildConfig(G, { remind_weekends: 1 });
  const cfg = db.getGuildConfig(G);

  const { client, sent } = fakeDiscord();
  await _internals.sendDailyReminder(client, cfg, { lastCall: false, today: '2025-09-07' });
  check('bat nhac cuoi tuan -> co gui', sent.length, 1);
  const e = sent[0].embeds[0].data;
  check('cuoi tuan dung tieu de nhe nhang', e.title.includes('Cuối tuần'), true);
  check('cuoi tuan van ping user', e.description.includes(`<@${U}>`), true);
  check('cuoi tuan KHONG doa mat streak', /mất thì tiếc lắm/.test(e.description), false);
  check('cuoi tuan noi ro khong dut streak', e.description.includes('không đứt streak'), true);

  sent.length = 0;
  await _internals.sendDailyReminder(client, cfg, { lastCall: true, today: '2025-09-07' });
  check('cuoi tuan khong goi lan cuoi', sent.length, 0);

  sent.length = 0;
  await _internals.sendDailyReminder(client, cfg, { lastCall: false, today: '2025-09-03' });
  check('ngay thuong van doa mat streak', /mất thì tiếc lắm/.test(sent[0].embeds[0].data.description), true);

  db.updateGuildConfig(G, { remind_weekends: 0 });
}

/* ----------------------------------------------------- tong ket tuan */
{
  const { client, sent } = fakeDiscord();
  await _internals.runWeeklyForGuild(client, db.getGuildConfig(G), '2025-09-07');
  check('tong ket tuan gui 2 tin', sent.length, 2);
  check('tong ket tuan dang o KENH chinh, khong chui vao thread', sent.every((m) => m.where === 'channel'), true);
  check('bao AI chua bat', sent[1].content.includes('GEMINI_API_KEY'), true);
}

/* ------------------------------------------ nhac chot ke hoach tuan sau */
{
  const CN = '2025-09-07'; // Chu nhat; tuan sau bat dau thu 2 08/09
  const nextWeek = '2025-09-08';

  {
    const { client, sent } = fakeDiscord();
    await _internals.sendWeeklyPlanReminder(client, db.getGuildConfig(G), CN);
    check('toi CN goi ten nguoi chua chot ke hoach', sent.length, 1);
    check('nhac o KENH chinh chu khong chui vao thread', sent[0].where, 'channel');
    check('nhac dung tuan BAT DAU SANG MAI', sent[0].embeds[0].data.title.includes('08/09'), true);
    check('ping dich danh nguoi chua co ke hoach', sent[0].embeds[0].data.description.includes(`<@${U}>`), true);
    check('noi ro duoc bao nhieu XP', sent[0].embeds[0].data.description.includes('+25 XP'), true);
  }

  {
    // Da chot ke hoach cho tuan sau -> khong bi goi ten nua.
    db.savePlan(G, U, nextWeek, 'ke hoach tuan sau', 1);
    const { client, sent } = fakeDiscord();
    await _internals.sendWeeklyPlanReminder(client, db.getGuildConfig(G), CN);
    check('ai chot roi thi khong bi nhac', sent[0].embeds[0].data.title.includes('đã có kế hoạch'), true);
    check('khong ping ai nua', sent[0].embeds[0].data.description.includes('<@'), false);
  }

  {
    // Tuan im ang, khong ai bao cao gi -> tong ket im lang nhung van phai nhac.
    const { client, sent } = fakeDiscord();
    await _internals.runWeeklyForGuild(client, db.getGuildConfig(G), '2025-10-05');
    check('tuan trong thi khong tong ket', sent.length, 0);
    await _internals.sendWeeklyPlanReminder(client, db.getGuildConfig(G), '2025-10-05');
    check('tuan trong van nhac chot ke hoach', sent.length, 1);
  }

  {
    // Khong con ai trong danh sach -> im hoan toan, khong noi vao khoang khong.
    db.setActive(G, U, false);
    const { client, sent } = fakeDiscord();
    await _internals.sendWeeklyPlanReminder(client, db.getGuildConfig(G), CN);
    check('khong co ai thi khong nhac', sent.length, 0);
    db.setActive(G, U, true);
  }
}

/* --------------------------------------------------------------- ghi chú */
{
  check('bỏ dấu tiếng Việt, cả chữ đ', notes.fold('Đọc Kỹ Trước Khi Dùng'), 'doc ky truoc khi dung');
  check('tag ngăn bằng dấu phẩy giữ được cụm hai chữ', notes.normalizeTags('#Học tập, Docker'), ['hoc-tap', 'docker']);
  check('tag ngăn bằng khoảng trắng trước #', notes.normalizeTags('#hoc #docker'), ['hoc', 'docker']);
  check('tag trùng chỉ tính một lần', notes.normalizeTags('docker, Docker, DOCKER'), ['docker']);
  check('tối đa 5 tag', notes.normalizeTags('a,b,c,d,e,f,g').length, 5);
  check('không có tag thì lưu chuỗi rỗng', notes.tagsToStored([]), '');
  check('tag lưu kèm dấu phẩy hai đầu', notes.tagsToStored(['a', 'b']), ',a,b,');
  check('tiêu đề lấy từ dòng đầu, bỏ ký tự markdown', notes.deriveTitle('## Cách dùng volume\nchi tiết'), 'Cách dùng volume');

  const mk = (title, body, tags, opts = {}) =>
    db.createNote({
      guildId: G,
      userId: opts.userId ?? U,
      title,
      body,
      tags: notes.tagsToStored(notes.normalizeTags(tags)),
      shared: opts.shared ?? false,
      date: '2025-09-05',
    });

  const n1 = mk('Docker volume', 'mount thư mục host vào container bằng cờ -v', 'docker');
  const n2 = mk('Học Rust', 'ownership và borrow checker', 'rust, hoc');
  const n3 = mk('Ghi chú chung', 'docker compose up -d chạy nền', 'docker, devops', { shared: true });
  const other = mk('Của người khác', 'redis pipeline', 'redis', { userId: 'user-khac', shared: true });
  const secret = mk('Riêng người khác', 'không ai thấy', '', { userId: 'user-khac' });

  check('số ghi chú đánh riêng theo từng người', [n1.no, n2.no, n3.no, other.no, secret.no], [1, 2, 3, 1, 2]);
  check('mặc định ghi chú là riêng tư', n1.shared, 0);

  const mine = { guildId: G, userId: U, scope: 'mine' };
  const server = { guildId: G, userId: U, scope: 'server' };
  check('đếm ghi chú của mình', db.countNotes(mine), 3);
  check('phạm vi server chỉ thấy ghi chú đã chia sẻ', db.countNotes(server), 2);
  check('lọc theo tag khớp trọn tag', db.countNotes({ ...mine, tag: 'docker' }), 2);
  check('tag không tồn tại thì không khớp gì', db.countNotes({ ...mine, tag: 'dock' }), 0);
  check('danh sách mới nhất trước', db.listNotes(mine).map((n) => n.no), [3, 2, 1]);
  check('phân trang', db.listNotes({ ...mine, limit: 2, offset: 2 }).map((n) => n.no), [1]);

  const search = (q, filter = mine) => notes.matchNotes(db.scanNotes(filter), q).map((n) => n.title);
  check('tìm không cần gõ dấu', search('hoc rust'), ['Học Rust']);
  check('tìm không phân biệt hoa thường', search('DOCKER').length, 2);
  check('khớp tiêu đề được xếp trước khớp nội dung', search('docker')[0], 'Docker volume');
  check('phải khớp mọi từ khoá', search('docker compose'), ['Ghi chú chung']);
  check('từ khoá không có thì không trả về gì', search('kubernetes'), []);
  check('tìm trong phạm vi server thấy cả ghi chú người khác', search('redis', server), ['Của người khác']);
  check('ghi chú riêng của người khác không lọt vào', search('không ai thấy', server), []);
  check('câu tìm kiếm rỗng trả về nguyên danh sách', search(''), search('', mine));

  check('đoạn trích bám quanh từ khoá', notes.snippet('a'.repeat(200) + ' docker ' + 'b'.repeat(200), 'docker').includes('docker'), true);

  const edited = db.updateNote(n2.id, { title: 'Rust nâng cao', body: 'lifetimes', tags: ',rust,', shared: true });
  check('sửa ghi chú giữ nguyên số', edited.no, n2.no);
  check('sửa xong có thể chuyển sang chia sẻ', db.countNotes(server), 3);

  check('xoá đúng một ghi chú', db.deleteNote(n1.id), 1);
  check('xoá rồi thì không đếm nữa', db.countNotes(mine), 2);
  check('số cũ không bị dùng lại', mk('Ghi chú mới', 'nội dung bất kỳ', '').no, 4);

  const tagList = db.noteTagRows(mine).flatMap((r) => notes.storedToTags(r.tags)).sort();
  check('gom tag từ ghi chú của mình', tagList, ['devops', 'docker', 'rust']);

  check(
    'lấy được chữ trong tin nhắn kèm embed và file',
    messageText({
      content: 'link hay',
      embeds: [{ title: 'Tiêu đề', description: 'mô tả' }],
      attachments: new Map([['1', { url: 'https://cdn/x.png' }]]),
    }),
    'link hay\n\nTiêu đề\nmô tả\n\nhttps://cdn/x.png',
  );
  check('tin nhắn rỗng thì không có gì để lưu', messageText({ content: '   ', embeds: [] }), '');
}

/* ------------------------------------------------ ghi chú: chạy thật lệnh */
{
  const NU = 'user-note-flow';

  function fakeNoteInteraction(sub, opts = {}) {
    const captured = { replies: [], modals: [], choices: null, deferred: null };
    const i = {
      captured,
      deferred: false,
      guildId: G,
      user: { id: NU, username: 'nguoi-ghi-chu', displayAvatarURL: () => 'https://avatar' },
      member: { displayName: 'Người ghi chú' },
      guild: {
        members: {
          fetch: async () => ({ displayName: 'Ai đó', displayAvatarURL: () => 'https://avatar' }),
        },
      },
      client: { channels: { fetch: async () => null } },
      options: {
        getSubcommand: () => sub,
        getString: (k) => opts[k] ?? null,
        getBoolean: (k) => (k in opts ? opts[k] : null),
        getInteger: (k) => opts[k] ?? null,
        getFocused: () => ({ name: opts._focused ?? 'note', value: opts._typed ?? '' }),
      },
      reply: async (payload) => {
        captured.replies.push(payload);
        return payload;
      },
      update: async (payload) => {
        captured.replies.push(payload);
        return payload;
      },
      showModal: async (modal) => {
        captured.modals.push(modal);
        return modal;
      },
      respond: async (choices) => {
        captured.choices = choices;
        return choices;
      },
      deferReply: async (options = {}) => {
        captured.deferred = options;
        i.deferred = true;
        return options;
      },
      editReply: async (payload) => {
        captured.replies.push(payload);
        return payload;
      },
    };
    return i;
  }

  const run = async (sub, opts) => {
    const i = fakeNoteInteraction(sub, opts);
    await note.execute(i);
    return i.captured;
  };

  let out = await run('add', {
    content: 'Dùng docker compose watch để hot reload khi sửa code',
    tags: 'docker, devops',
  });
  check('lưu ghi chú xong báo lại số của nó', out.replies[0].content.includes('#1'), true);
  check('trả lời trước 3 giây rồi mới làm việc nặng', out.deferred !== null, true);
  check('xác nhận lưu chỉ mình mình thấy', out.deferred.flags, MessageFlags.Ephemeral);

  await run('add', { content: 'Postgres: EXPLAIN ANALYZE đọc từ dưới lên', tags: 'sql' });
  await run('add', { content: 'Ghi chú cho cả nhóm về quy trình release', share: true });

  out = await run('add', {});
  check('không gõ nội dung thì mở ô soạn', out.modals.length, 1);

  out = await run('list', {});
  check('danh sách đếm đủ ghi chú', out.replies[0].embeds[0].data.footer.text.includes('3 ghi chú'), true);
  check('danh sách hiện số ghi chú của mình', out.replies[0].embeds[0].data.description.includes('`#3`'), true);

  out = await run('list', { tag: 'sql' });
  check('lọc theo tag chỉ còn một', out.replies[0].embeds[0].data.footer.text.includes('1 ghi chú'), true);

  out = await run('search', { query: 'compose' });
  check('tìm ra đúng ghi chú', out.replies[0].embeds[0].data.title.includes('1 kết quả'), true);

  out = await run('search', { query: 'kubernetes' });
  check('không có kết quả thì nói thẳng', out.replies[0].content.includes('Không có ghi chú nào khớp'), true);

  out = await run('show', { note: '#2' });
  check('mở ghi chú theo số', out.replies[0].embeds[0].data.title.includes('#2'), true);

  out = await run('show', { note: 'explain analyze' });
  check('mở ghi chú theo tiêu đề', out.replies[0].embeds[0].data.title.includes('#2'), true);

  out = await run('show', { note: '#99' });
  check('số không có thì báo không tìm thấy', out.replies[0].content.includes('Không tìm thấy'), true);

  out = await run('show', { note: '#1', public: true });
  check('chọn public thì cả kênh thấy', out.deferred.flags, undefined);

  out = await run('tags', {});
  check('bảng tag đếm đúng', out.replies[0].embeds[0].data.description.includes('`#docker` — 1'), true);

  const acTag = fakeNoteInteraction('list', { _focused: 'tag', _typed: 'doc' });
  await note.autocomplete(acTag);
  check('gợi ý tag lọc theo chữ đang gõ', acTag.captured.choices.map((c) => c.value), ['docker']);

  const target = db.listNotes({ guildId: G, userId: NU, scope: 'mine' }).find((n) => n.no === 1);
  out = await run('delete', { note: '#1' });
  check('xoá phải bấm xác nhận', out.replies[0].components.length, 1);

  const before = db.countNotes({ guildId: G, userId: NU, scope: 'mine' });
  const btn = fakeNoteInteraction('delete', {});
  btn.customId = `note:del:${target.id}`;
  await note.handleButton(btn);
  check('bấm xác nhận mới thật sự xoá', db.countNotes({ guildId: G, userId: NU, scope: 'mine' }), before - 1);

  const cancel = fakeNoteInteraction('delete', {});
  cancel.customId = 'note:cancel';
  await note.handleButton(cancel);
  check('bấm thôi thì không xoá gì', db.countNotes({ guildId: G, userId: NU, scope: 'mine' }), before - 1);

  const ac = fakeNoteInteraction('show', { _focused: 'note', _typed: 'postgres' });
  await note.autocomplete(ac);
  check('gợi ý trả về mã dán được vào lệnh', /^id:\d+$/.test(ac.captured.choices[0].value), true);
  check('gợi ý hiện tiêu đề', ac.captured.choices[0].name.includes('Postgres'), true);

  const fromMenu = fakeNoteInteraction('add', {});
  fromMenu.customId = 'notesave:111:222';
  fromMenu.fields = {
    getTextInputValue: (k) => ({ title: '', body: 'mẹo hay vừa trôi qua trong kênh', tags: 'vot-lai' })[k],
  };
  await noteSave.handleModal(fromMenu);
  const vot = db.listNotes({ guildId: G, userId: NU, scope: 'mine' })[0];
  check('lưu từ menu chuột phải giữ link tin nhắn gốc', vot.source_url, `https://discord.com/channels/${G}/111/222`);
  check('lưu từ menu chuột phải tự đặt tiêu đề', vot.title, 'mẹo hay vừa trôi qua trong kênh');

  // Ghi chú riêng của người khác không được lộ qua bất kỳ đường nào.
  db.createNote({
    guildId: G,
    userId: 'nguoi-la',
    title: 'Mật khẩu wifi',
    body: 'khong-ai-duoc-thay',
    tags: '',
    shared: 0,
    date: '2025-09-05',
  });
  out = await run('search', { query: 'khong-ai-duoc-thay', scope: 'server' });
  check('ghi chú riêng của người khác không tìm ra', out.replies[0].content.includes('Không có ghi chú nào khớp'), true);

  const sneaky = db.listNotes({ guildId: G, userId: 'nguoi-la', scope: 'mine' })[0];
  out = await run('show', { note: `id:${sneaky.id}` });
  check('gõ thẳng mã cũng không mở được ghi chú riêng của người khác', out.replies[0].content.includes('Không tìm thấy'), true);
}

/* ------------------------------- mat mang giua chung thi khong duoc mat du lieu */
// deferReply la loi goi mang DAU TIEN trong luong. No nem loi (ENOTFOUND) thi moi
// thu ghi vao SQLite phai da xong tu truoc, khong thi bao cao vua go bay mat.
{
  const OU = 'user-mat-mang';
  const offlineDate = '2025-09-10';

  function offlineInteraction(fields, customId) {
    return {
      customId,
      guildId: G,
      deferred: false,
      user: { id: OU, username: 'mat-mang', displayAvatarURL: () => 'https://avatar' },
      member: { displayName: 'Mất mạng' },
      guild: { members: { fetch: async () => null } },
      client: { channels: { fetch: async () => null } },
      fields: { getTextInputValue: (k) => fields[k] ?? '' },
      options: {
        getSubcommand: () => 'add',
        getString: () => null,
        getBoolean: () => null,
        getInteger: () => null,
      },
      reply: async (p) => p,
      deferReply: async () => {
        throw new Error('getaddrinfo ENOTFOUND discord.com');
      },
    };
  }

  const dailyModule = await import('../src/commands/daily.js');
  const daily = offlineInteraction(
    { done: 'Hoc shadowing tieng Nhat 30 phut va lam xong bai nghe N2', next: '', blocker: '' },
    `daily:${offlineDate}`,
  );
  let dailyThrew = false;
  await dailyModule.handleModal(daily).catch(() => {
    dailyThrew = true;
  });
  check('deferReply that su bi goi (test khong rong)', dailyThrew, true);
  const saved = db.getDaily(G, OU, offlineDate);
  check('mat mang van ghi duoc bao cao daily', saved?.done.startsWith('Hoc shadowing'), true);
  check('mat mang van cong XP', saved?.xp > 0, true);

  const noteBefore = db.countNotes({ guildId: G, userId: OU, scope: 'mine' });
  const offlineNote = offlineInteraction({ title: '', body: 'ghi chu luc mat mang', tags: '' }, 'note:add:0');
  let noteThrew = false;
  await note.saveNote(offlineNote, { body: 'ghi chu luc mat mang', shared: false }).catch(() => {
    noteThrew = true;
  });
  check('saveNote cung cham toi deferReply', noteThrew, true);
  check(
    'mat mang van ghi duoc ghi chu',
    db.countNotes({ guildId: G, userId: OU, scope: 'mine' }),
    noteBefore + 1,
  );
}

if (failures) {
  console.error(`❌ ${failures} kiểm tra thất bại`);
  process.exit(1);
}
console.log('✅ Toàn bộ kiểm tra đã qua');
