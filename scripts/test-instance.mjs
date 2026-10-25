// Тестовый экземпляр для проверки интерфейса: своя временная база, порты 4200/5174,
// перематываемые часы. Настоящая база и Google не затрагиваются.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(tmpdir(), 'ou-test-instance.sqlite');
for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });

const env = {
  ...process.env,
  SERVER_PORT: '4200',
  OU_DB_PATH: dbPath,
  APP_URL: 'http://localhost:5174',
};
const run = (args) => spawn('npm', args, { env, stdio: 'inherit', shell: true });
run(['run', 'start', '-w', '@ou/server']);
run(['run', 'dev', '-w', '@ou/web', '--', '--port', '5174']);
