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

/* ------------------------------------------------------ luong nhac nho / cron */
const { _internals } = await import('../src/scheduler.js');

function fakeClient(sent) {
  return {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => sent.push(p) }) },
    guilds: { fetch: async () => ({ members: { fetch: async () => null } }) },
  };
}

db.updateGuildConfig(G, { channel_id: 'chan-1' });
const guildCfg = db.getGuildConfig(G);

// Thu 4 03/09: user chua bao cao -> phai bi nhac va neu ro streak dang treo.
const nudges = [];
await _internals.sendDailyReminder(fakeClient(nudges), guildCfg, { lastCall: false, today: '2025-09-03' });
check('gui dung 1 loi nhac', nudges.length, 1);
check('loi nhac ping dung user', nudges[0].embeds[0].data.description.includes(`<@${U}>`), true);
check('loi nhac neu streak dang treo', nudges[0].embeds[0].data.description.includes('2** ngay') || nudges[0].embeds[0].data.description.includes('2** ngày'), true);

// Thu 3 02/09: da bao cao roi -> khong ping ai, chi khen.
const praise = [];
await _internals.sendDailyReminder(fakeClient(praise), guildCfg, { lastCall: false, today: '2025-09-02' });
check('da bao cao thi khong bi ping', praise[0].embeds[0].data.description.includes('@'), false);

// Cuoi tuan (chu nhat 07/09) -> khong nhac vi che do weekdays.
const weekendNudge = [];
await _internals.sendDailyReminder(fakeClient(weekendNudge), guildCfg, { lastCall: false, today: '2025-09-07' });
check('cuoi tuan khong bi nhac', weekendNudge.length, 0);

// Tong ket tuan: 1 mo dau + 1 review/nguoi + 1 nhac /weekly plan.
const weekly = [];
await _internals.runWeeklyForGuild(fakeClient(weekly), guildCfg, '2025-09-07');
check('tong ket tuan gui 3 tin', weekly.length, 3);
check('bao AI chua bat', weekly[1].content.includes('GEMINI_API_KEY'), true);
check('ket bang loi nhac ke hoach tuan sau', weekly[2].embeds[0].data.title.includes('Vòng lặp tiếp theo'), true);

if (failures) {
  console.error(`❌ ${failures} kiểm tra thất bại`);
  process.exit(1);
}
console.log('✅ Toàn bộ kiểm tra đã qua');
