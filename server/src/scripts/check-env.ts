// Проверяет .env, не показывая секретов: npm run check:env
import { checkGoogleConfig, loadConfig, readEnvFile } from '../config';

if (!readEnvFile()) {
  console.error('Файл .env не найден. Скопируй .env.example в .env и заполни ключи Google.');
  process.exit(1);
}

const config = loadConfig();
const problems = checkGoogleConfig(config);

if (problems.length > 0) {
  console.error('Настройки Google пока не готовы:');
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

console.log('Ключи Google на месте.');
console.log(`Адрес возврата: ${config.google.redirectUri}`);
