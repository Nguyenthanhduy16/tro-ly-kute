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
  check('tong ket tuan gui 3 tin', sent.length, 3);
  check('tong ket tuan dang o KENH chinh, khong chui vao thread', sent.every((m) => m.where === 'channel'), true);
  check('bao AI chua bat', sent[1].content.includes('GEMINI_API_KEY'), true);
  check('ket bang loi nhac ke hoach tuan sau', sent[2].embeds[0].data.title.includes('Vòng lặp tiếp theo'), true);
}

if (failures) {
  console.error(`❌ ${failures} kiểm tra thất bại`);
  process.exit(1);
}
console.log('✅ Toàn bộ kiểm tra đã qua');
