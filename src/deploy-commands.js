import { REST, Routes } from 'discord.js';
import { assertRuntimeConfig, config } from './config.js';
import { commandJSON } from './commands/index.js';

assertRuntimeConfig();

const rest = new REST().setToken(config.token);

const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

const scope = config.guildId ? `server ${config.guildId} (hiện ngay lập tức)` : 'toàn cục (Discord cache tới ~1 giờ)';

try {
  const data = await rest.put(route, { body: commandJSON });
  console.log(`✅ Đã đăng ký ${data.length} lệnh vào ${scope}:`);
  for (const cmd of data) console.log(`   /${cmd.name} — ${cmd.description}`);
} catch (err) {
  console.error('❌ Đăng ký lệnh thất bại:', err);
  process.exit(1);
}
