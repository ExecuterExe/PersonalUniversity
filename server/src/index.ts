import { buildApp } from './app';
import { loadConfig, readEnvFile } from './config';

readEnvFile();
const config = loadConfig();
const app = buildApp(config);

// Только localhost: сервис не должен быть виден другим устройствам в сети.
await app.listen({ host: 'localhost', port: config.port });
console.log(`Сервер «Мой университет» запущен: http://localhost:${config.port}`);
