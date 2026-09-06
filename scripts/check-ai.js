/**
 * Kiểm tra key + tên model trong .env có thật sự gọi được không.
 * Chạy: npm run check-ai
 */
import { config } from '../src/config.js';

const fail = (...msg) => {
  for (const m of msg) console.error(m);
  process.exitCode = 1;
};

const shortError = (body) => {
  try {
    const j = JSON.parse(body);
    return j.error?.message ?? JSON.stringify(j.error ?? j).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
};

/* ------------------------------------------------------------------ Gemini */

async function checkGemini() {
  const headers = { 'x-goog-api-key': config.ai.apiKey };

  const listRes = await fetch(`${config.ai.baseUrl}/models?pageSize=200`, { headers });
  if (!listRes.ok) {
    const body = await listRes.text();
    fail(`❌ Không liệt kê được model — HTTP ${listRes.status}`, shortError(body));
    if (body.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') || body.includes('API_KEY_INVALID')) {
      console.error(`\n👉 Key trong ${config.ai.keyEnvVar} không được chấp nhận. Tạo key mới ở ${config.ai.keyUrl}`);
    }
    return null;
  }

  const { models = [] } = await listRes.json();
  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

/* -------------------------------------------------------------- OpenRouter */

async function checkOpenRouter() {
  const auth = { authorization: `Bearer ${config.ai.apiKey}` };

  // /key vừa xác thực key vừa cho biết còn bao nhiêu tín dụng.
  const keyRes = await fetch(`${config.ai.baseUrl}/key`, { headers: auth });
  if (!keyRes.ok) {
    fail(`❌ Key không dùng được — HTTP ${keyRes.status}`, shortError(await keyRes.text()));
    console.error(`\n👉 Kiểm tra lại ${config.ai.keyEnvVar}, hoặc tạo key mới ở ${config.ai.keyUrl}`);
    return null;
  }

  const { data: k = {} } = await keyRes.json();
  const used = Number(k.usage ?? 0);
  const limit = k.limit === null || k.limit === undefined ? null : Number(k.limit);
  console.log(`✅ Key hợp lệ${k.label ? ` (${k.label})` : ''}`);
  console.log(`   Đã dùng: $${used.toFixed(4)}${limit === null ? ' · hạn mức: không giới hạn' : ` / $${limit.toFixed(2)} · còn $${(limit - used).toFixed(4)}`}`);
  if (k.is_free_tier) console.log('   Tài khoản đang ở free tier — chỉ gọi được các model có hậu tố ":free".');

  const listRes = await fetch(`${config.ai.baseUrl}/models`);
  if (!listRes.ok) {
    fail(`❌ Không tải được danh sách model — HTTP ${listRes.status}`);
    return null;
  }
  const { data = [] } = await listRes.json();
  return data.map((m) => m.id);
}

/* ------------------------------------------------------------------- main */

const main = async () => {
  console.log(`Provider : ${config.ai.provider}`);
  console.log(`Model    : ${config.ai.model}\n`);

  if (!config.ai.apiKey) {
    return fail(`❌ Chưa có ${config.ai.keyEnvVar} trong .env — lấy key ở ${config.ai.keyUrl}`);
  }

  const usable = config.ai.provider === 'openrouter' ? await checkOpenRouter() : await checkGemini();
  if (!usable) return;

  console.log(`\n✅ ${usable.length} model khả dụng.`);
  const configured = usable.includes(config.ai.model);
  console.log(`${configured ? '✅' : '❌'} "${config.ai.model}" ${configured ? 'có trong danh sách' : 'KHÔNG có trong danh sách'}`);

  if (!configured) {
    const stem = config.ai.model.split(/[/:]/).filter(Boolean)[0] ?? '';
    const near = usable.filter((m) => m.includes(stem)).slice(0, 15);
    console.log(near.length ? '\nCác tên gần giống:' : '\nVài model khả dụng:');
    for (const m of (near.length ? near : usable.slice(0, 15))) console.log(`   ${m}`);
    return fail('');
  }

  // Gọi thật một câu ngắn: xác nhận quota, quyền và định dạng response đều ổn.
  const { generateWeeklyReview } = await import('../src/ai.js');
  process.stdout.write('\nĐang gọi thử model… ');
  try {
    const { text } = await generateWeeklyReview({
      displayName: 'Người Thử Nghiệm',
      weekStart: '2025-09-01',
      weekEnd: '2025-09-07',
      plan: 'Dựng xong bot Discord báo cáo daily.',
      dailies: [
        {
          report_date: '2025-09-01',
          done: 'Dựng schema SQLite và viết xong lệnh /daily kèm modal nhiều dòng.',
          next_plan: 'Làm phần streak',
          blocker: '',
        },
      ],
      stats: { reported: 1, expected: 5, missed: ['2025-09-02'], totalChars: 64, avgChars: 64, blockerDays: 0, streak: 1, bestStreak: 1 },
    });
    console.log('xong.\n');
    console.log('── Thử một bản nhận xét thật ──────────────────────────────');
    console.log(text);
    console.log('───────────────────────────────────────────────────────────');
  } catch (err) {
    console.log('');
    fail(`❌ Gọi thử thất bại: ${err.message}`);
  }
};

await main();
