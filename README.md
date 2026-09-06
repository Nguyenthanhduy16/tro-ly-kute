# Trợ lý báo cáo daily cho Discord

Bot Discord giúp bạn (và nhóm bạn) ghi lại công việc mỗi ngày, giữ streak, cộng XP,
và cuối tuần được một "HR khó tính" chạy bằng LLM đọc lại toàn bộ báo cáo rồi
nhận xét thẳng thắn — có đối chiếu với đúng bản kế hoạch bạn đã cam kết đầu tuần.

## Vòng lặp

```
Thứ 2 → /weekly plan     chốt cam kết cho tuần (+25 XP)
   ↓
mỗi ngày → /daily        ghi việc đã làm (+10-31 XP, streak tăng)
   ↓         bot nhắc lúc 21:00, gọi lần cuối 23:00 nếu chưa nộp
   ↓
Chủ nhật 20:00 → bot tự tổng hợp, so cam kết với thực tế,
                 chấm điểm /10 và giao 3 việc cụ thể cho tuần sau
   ↓
   └──────────→ /weekly plan cho tuần mới
```

## Cài đặt

### 1. Tạo bot trên Discord

1. Vào https://discord.com/developers/applications → **New Application**.
2. Tab **Bot** → **Reset Token** → copy token (đây là `DISCORD_TOKEN`).
3. Tab **General Information** → copy **Application ID** (đây là `DISCORD_CLIENT_ID`).
4. Không cần bật privileged intent nào cả — bot chỉ dùng intent `Guilds`.
5. Mời bot vào server bằng link sau (thay `CLIENT_ID` bằng Application ID của bạn):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=309506099200&scope=bot%20applications.commands
```

`permissions=309506099200` = Send Messages + Embed Links + Create Public Threads +
Send Messages in Threads. Không xin gì thừa — không đọc tin nhắn, không xoá gì.

### 2. Lấy key cho phần AI review

Bot chạy được với **OpenRouter** (mặc định) hoặc **Gemini gọi thẳng**. Chọn bằng `AI_PROVIDER` trong `.env`.

**OpenRouter** — https://openrouter.ai/keys → `OPENROUTER_API_KEY`.
Một key dùng được hơn 400 model của mọi hãng, đổi model chỉ là sửa `OPENROUTER_MODEL`.
Tên model và giá tra ở https://openrouter.ai/models. Các model có hậu tố `:free` thì miễn phí
(kèm giới hạn tốc độ); còn lại tính theo token — một bản review tốn cỡ 2.000 token vào + 700 ra,
tức dưới 1 xu ngay cả với model đắt.

**Gemini gọi thẳng** — https://aistudio.google.com/apikey → `GEMINI_API_KEY`.
⚠️ Free tier của Google **không có quota cho các model `pro`** (gọi vào là 429 kèm `limit: 0`);
muốn dùng `pro` phải bật billing. Các model `flash` thì free tier chạy được.

Chưa có key nào thì bot vẫn chạy — chỉ là cuối tuần có số liệu thô chứ không có nhận xét.

Kiểm tra key và tên model bất cứ lúc nào bằng `npm run check-ai`: nó gọi thật, liệt kê model
khả dụng, báo tên bạn đặt có hợp lệ không, rồi in ra một bản nhận xét mẫu.

### 3. Chạy

```bash
cp .env.example .env
```

Điền `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` và key AI ở bước 2
(bật Developer Mode trong Discord → chuột phải lên server → Copy Server ID).

```bash
npm install
npm run deploy
npm start
```

`npm run deploy` chỉ cần chạy lại khi bạn sửa định nghĩa lệnh.

### 4. Cấu hình trong Discord

```
/setup set channel:#báo-cáo remind_hour:21 last_call_hour:23 weekly_dow:Chủ nhật weekly_hour:20
```

Không đặt `channel` thì bot không biết nhắc ở đâu — nhắc nhở và tổng kết tuần sẽ im lặng.

## Kênh trông như thế nào

Bot gom mọi thứ của một ngày vào **một thread duy nhất** trong kênh bạn chỉ định:

```
#workspace
├─ 📅 08/09 (T2)   ← thread hôm nay, đang mở
│    ├─ báo cáo của Duy
│    ├─ báo cáo của An
│    └─ 21:00 · bot nhắc những ai chưa nộp
├─ 📅 07/09 (CN)   ← qua 24h Discord tự lưu trữ, thu gọn khỏi danh sách
└─ 📊 Tổng kết tuần 01/09 → 07/09   ← đánh giá tuần đăng thẳng ra kênh
```

Ngày hôm sau, thread cũ tự lưu trữ: biến mất khỏi danh sách kênh nhưng **không mất gì**,
bấm vào là đọc lại được. Không có tin nhắn nào bị xoá.

Khi bạn gõ `/daily`, nội dung báo cáo được đăng vào thread cho cả nhóm thấy, còn bạn nhận
riêng một dòng xác nhận kèm XP và link tới bài — cùng một nội dung không hiện hai lần.
Nộp lại `/daily` cho ngày đó thì bot **sửa đúng bài cũ** chứ không đăng thêm bài mới.

Đánh giá tuần cố ý đăng ra kênh chính chứ không chui vào thread: mỗi tuần một lần,
và đó là thứ đáng để nhìn thấy.

Không thích thread thì tắt: `/setup set threads:False` — mọi thứ quay lại đăng thẳng ra kênh.

## Cấp bậc đổi màu tên

Đạt mốc XP thì bot gán role tương ứng và **tên bạn trong danh sách thành viên đổi màu**.
Mỗi người luôn giữ đúng một role cấp bậc — lên cấp là role cũ tự gỡ.

| Cấp | Từ | Ước lượng |
|---|---|---|
| 🌱 Mầm | 40 XP | ~2 ngày |
| ⚡ Đều đặn | 160 XP | ~1,5 tuần |
| 🔥 Bền bỉ | 360 XP | ~3 tuần |
| 💎 Kỷ luật | 640 XP | ~6 tuần |
| 🏆 Thép | 1.000 XP | ~2 tháng |
| 👑 Huyền thoại | 1.960 XP | ~4 tháng |

Level 1 cố ý không có màu: ai cũng bắt đầu xám, màu là thứ phải kiếm. Khoảng cách giữa
các cấp nới dần nên cấp cao không mất giá sau vài tháng.

Bật bằng `/setup roles` (cần quyền Manage Server). Bot chỉ tạo role khi bạn gõ lệnh này —
không tự ý thêm gì vào server. Role đặt `hoist: false`, tức **chỉ đổi màu tên** chứ không
tách thành mục riêng trong danh sách thành viên, tránh làm rối sidebar.

Muốn đổi tên cấp, mốc XP hay màu thì sửa mảng `RANKS` ở đầu [`src/ranks.js`](src/ranks.js).

## Các lệnh

| Lệnh | Việc nó làm |
|---|---|
| `/daily` | Mở form nhiều dòng để viết báo cáo hôm nay |
| `/daily done:... next:... blocker:...` | Nộp nhanh ngay trên thanh lệnh |
| `/daily day:Hôm qua` | Bổ sung cho hôm qua nếu lỡ quên (không được tính XP đúng hạn) |
| `/weekly plan` | Chốt cam kết cho tuần (+25 XP) |
| `/weekly show` | Xem kế hoạch tuần + tiến độ hiện tại |
| `/weekly review` | Bắt trợ lý nhận xét ngay, không đợi Chủ nhật |
| `/streak` | Streak, XP, level, dải 14 ngày gần nhất |
| `/leaderboard` | BXH XP theo tuần / 30 ngày / toàn thời gian |
| `/history` | Đọc lại các báo cáo cũ |
| `/setup roles` | Tạo role cấp bậc đổi màu tên |
| `/setup pause` \| `/setup resume` | Tự tắt/bật nhắc nhở cho riêng mình |

Nộp lại `/daily` cho ngày đã có báo cáo = **sửa** báo cáo đó, không cộng XP lần hai.

## XP và streak

Mỗi báo cáo daily: **10 XP nền**, cộng thêm

| Thưởng | XP |
|---|---|
| Viết chi tiết (mỗi 60 ký tự vượt mức tối thiểu) | tối đa +5 |
| Có ghi việc kế tiếp | +2 |
| Dám nêu vướng mắc | +1 |
| Nộp trước `ON_TIME_HOUR` (mặc định 22:00) | +3 |
| Streak hiện tại | +1/ngày, trần +10 |

Tối đa **31 XP/ngày**. Kế hoạch tuần **+25 XP**. Level lên theo căn bậc hai của XP
(40 XP → lv.2, 360 XP → lv.4, 1000 XP → lv.6) nên càng lên càng chậm.

**Streak** được tính lại từ dữ liệu mỗi lần đọc, không lưu trạng thái nên không bao giờ lệch.
Mặc định `STREAK_MODE=weekdays`: nghỉ Thứ 7/Chủ nhật **không** làm đứt chuỗi. Muốn khắt khe
hơn thì đổi thành `everyday` trong `.env`.

Báo cáo lúc 1-2h sáng vẫn được tính cho **ngày hôm trước** (`DAY_ROLLOVER_HOUR=4`).

## Chạy ở đâu

Bot phải **online lúc đến giờ nhắc** thì mới nhắc được — cron chỉ chạy khi tiến trình còn sống.

**Bắt đầu:** chạy `npm start` trên máy bạn. Dùng thử 1-2 tuần xem có hợp không đã.
Nhược điểm: máy tắt lúc 21:00 thì hôm đó không có lời nhắc (báo cáo và streak vẫn ghi
bình thường khi bạn bật lại và gõ `/daily`).

**Khi đã quen tay, chuyển sang chạy 24/7.** Bot này rất nhẹ (~100MB RAM), nên chọn gì cũng được:

- **Máy cũ / Raspberry Pi ở nhà** — rẻ nhất, đủ dùng, `npm start` trong `pm2` hoặc systemd.
- **Oracle Cloud Always Free** — VM ARM miễn phí vĩnh viễn, mạnh dư sức. Đăng ký hơi lằng nhằng.
- **VPS rẻ** (Hetzner, Vultr, DigitalOcean) — ~4-6 USD/tháng, dựng nhanh, ít phiền.
- **Railway / Render / Fly.io** — deploy dễ nhất bằng `Dockerfile` có sẵn, nhưng chính sách
  free tier của mấy chỗ này thay đổi liên tục, kiểm tra giá trước khi cắm thẻ.

Có `Dockerfile` sẵn trong repo. Nhớ mount volume vào `/data` (đã set `DB_PATH=/data/bot.db`),
nếu không thì deploy lại là mất sạch streak và XP.

```bash
docker build -t daily-bot .
docker run -d --env-file .env -v daily-bot-data:/data --restart unless-stopped daily-bot
```

## Cấu trúc

```
src/
  index.js          bootstrap client, định tuyến interaction
  config.js         đọc .env
  dates.js          mọi phép tính ngày theo múi giờ + "ngày làm việc"
  db.js             schema SQLite (node:sqlite, không cần build native)
  xp.js             streak, XP, level — hàm thuần, có test
  ranks.js          cấp bậc, tạo và gán role đổi màu tên
  ai.js             prompt HR + lớp provider (OpenRouter / Gemini)
  review.js         gom dữ liệu tuần, dựng embed đánh giá
  scheduler.js      một cron mỗi giờ, đọc cấu hình từng server
  commands/         mỗi lệnh một file
scripts/selftest.js  81 kiểm tra logic, chạy `npm test`, không cần Discord
scripts/check-ai.js  chẩn đoán key + model, chạy `npm run check-ai`
scripts/send-reminder.js  bắn lời nhắc thủ công, chạy `npm run remind`
data/bot.db          dữ liệu (đã gitignore)
```

Không có phụ thuộc native: dữ liệu dùng `node:sqlite` có sẵn trong Node 22.5+.

## Chỉnh giọng nhận xét

Toàn bộ tính cách của "HR" nằm ở `SYSTEM_PROMPT` trong [`src/ai.js`](src/ai.js).
Thấy gắt quá thì sửa, thấy còn nhẹ tay thì cũng sửa ở đúng chỗ đó.
