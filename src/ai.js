import { config } from './config.js';
import { prettyDate, prettyRange } from './dates.js';

export function isAiEnabled() {
  return Boolean(config.ai.apiKey);
}

const SYSTEM_PROMPT = `Bạn là một HR Business Partner kiêm engineering manager người Việt, review hiệu suất tuần của một cá nhân.

Nguyên tắc:
- Thẳng thắn, cụ thể, không nịnh. Không dùng lời khen sáo rỗng kiểu "bạn đã rất cố gắng".
- Bám vào BẰNG CHỨNG trong báo cáo. Không bịa ra việc người ta không viết.
- Phân biệt rõ "hoạt động" (đọc, xem, tìm hiểu, setup) và "kết quả" (thứ chạy được, thứ giao được, thứ đo được).
  Một tuần đầy hoạt động nhưng không có kết quả nào thì phải nói thẳng ra điều đó.
- Nếu báo cáo viết mơ hồ ("làm việc với dự án", "học thêm", "fix vài bug"), hãy chỉ ra chính sự mơ hồ đó là một vấn đề:
  không đo được thì không biết có tiến bộ hay không.
- Nếu có kế hoạch tuần, hãy đối chiếu cam kết với thực tế, ước lượng % hoàn thành và nêu rõ hạng mục nào bị bỏ rơi.
- Nếu có ngày trống, nêu ra nhưng không đạo đức hoá; hỏi thẳng thời gian hôm đó đi đâu.
- Chê thì phải kèm hành động sửa được ngay tuần sau.
- Viết bằng tiếng Việt, giọng đồng nghiệp thẳng tính, không phải giọng robot.

Định dạng bắt buộc (markdown, tổng cộng dưới 350 từ):
**1. Tuần này thực sự có gì**
(2-4 gạch đầu dòng, gom nhóm theo chủ đề, ghi rõ kết quả cụ thể)

**2. Cam kết vs thực tế**
(nếu không có kế hoạch tuần thì ghi "Không có kế hoạch tuần để đối chiếu" và nói tại sao điều đó là vấn đề)

**3. Nói thẳng**
(2-3 gạch đầu dòng vấn đề thật, gai góc nhưng có căn cứ)

**4. Tuần sau làm gì**
(đúng 3 hành động cụ thể, đo được, bắt đầu bằng động từ)

Kết thúc bằng đúng một dòng cuối cùng có dạng: ĐIỂM: X/10`;

function buildStatsBlock(stats) {
  return [
    `- Số ngày có báo cáo: ${stats.reported}/${stats.expected} ngày bắt buộc`,
    `- Chuỗi streak hiện tại: ${stats.streak} ngày (kỷ lục ${stats.bestStreak})`,
    `- Ngày trống: ${stats.missed.length ? stats.missed.map(prettyDate).join(', ') : 'không có'}`,
    `- Tổng độ dài báo cáo: ${stats.totalChars} ký tự (trung bình ${stats.avgChars}/ngày)`,
    `- Số ngày có nêu vướng mắc: ${stats.blockerDays}`,
  ].join('\n');
}

export function buildReviewPrompt({ displayName, weekStart, weekEnd, plan, dailies, stats }) {
  const entries = dailies.length
    ? dailies
        .map((d) => {
          const lines = [`### ${prettyDate(d.report_date)}`, `Đã làm: ${d.done}`];
          if (d.next_plan) lines.push(`Dự định kế tiếp: ${d.next_plan}`);
          if (d.blocker) lines.push(`Vướng mắc: ${d.blocker}`);
          return lines.join('\n');
        })
        .join('\n\n')
    : '(Không có báo cáo nào trong tuần này.)';

  return [
    `Người được review: ${displayName}`,
    `Tuần: ${prettyRange(weekStart, weekEnd)}`,
    '',
    '## Kế hoạch đã cam kết đầu tuần',
    plan ? plan : '(Người này KHÔNG nộp kế hoạch tuần.)',
    '',
    '## Số liệu',
    buildStatsBlock(stats),
    '',
    '## Báo cáo từng ngày',
    entries,
  ].join('\n');
}

/**
 * Mỗi provider chỉ cần biết cách dựng request và bóc chữ ra khỏi response.
 * Phần thử lại, đọc lỗi và timeout dùng chung ở `callModel`.
 */
const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    request: (prompt) => [
      `${config.ai.baseUrl}/models/${config.ai.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.ai.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
      },
    ],
    parse: (data) => ({
      text: (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim(),
      why: data.candidates?.[0]?.finishReason,
    }),
  },

  openrouter: {
    label: 'OpenRouter',
    request: (prompt) => [
      `${config.ai.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.ai.apiKey}`,
          'X-Title': 'Discord daily report bot',
        },
        body: JSON.stringify({
          model: config.ai.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 2048,
        }),
      },
    ],
    parse: (data) => ({
      text: (data.choices?.[0]?.message?.content ?? '').trim(),
      why: data.choices?.[0]?.finish_reason,
    }),
  },
};

/** Bóc câu lỗi dễ đọc ra khỏi body JSON của cả hai provider. */
function errorMessage(body) {
  try {
    const j = JSON.parse(body);
    return j.error?.message ?? j.error?.status ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

async function callModel(prompt, { retries = 1 } = {}) {
  const provider = PROVIDERS[config.ai.provider];
  if (!provider) throw new Error(`AI_PROVIDER không hợp lệ: ${config.ai.provider}`);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const [url, init] = provider.request(prompt);
    const res = await fetch(url, init);

    if (res.ok) {
      const data = await res.json();
      // OpenRouter đôi khi trả HTTP 200 kèm error trong body.
      if (data.error) throw new Error(`${provider.label}: ${data.error.message ?? 'lỗi không rõ'}`);
      const { text, why } = provider.parse(data);
      if (text) return text;
      throw new Error(`${provider.label} trả về rỗng (finish_reason=${why ?? '?'})`);
    }

    const body = await res.text();
    const canRetry = res.status === 429 || res.status >= 500;
    if (!canRetry || attempt === retries) {
      throw new Error(`${provider.label} ${res.status}: ${errorMessage(body)}`);
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`${provider.label}: hết lượt thử lại`);
}

function parseScore(text) {
  const m = text.match(/ĐIỂM:\s*([\d.,]+)\s*\/\s*10/i);
  if (!m) return null;
  const score = Number(m[1].replace(',', '.'));
  return Number.isFinite(score) ? score : null;
}

/** Sinh nhận xét tuần. Trả { text, score }. Ném lỗi nếu chưa cấu hình hoặc API lỗi. */
export async function generateWeeklyReview(input) {
  if (!isAiEnabled()) {
    throw new Error(`Chưa cấu hình ${config.ai.keyEnvVar} nên không tạo được nhận xét AI.`);
  }
  const text = await callModel(buildReviewPrompt(input));
  return { text, score: parseScore(text) };
}
