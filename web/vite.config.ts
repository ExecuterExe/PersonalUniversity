import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Порт сервера берём из общего .env в корне проекта.
  const env = loadEnv(mode, ROOT_DIR, '');
  const serverUrl = `http://127.0.0.1:${env.SERVER_PORT || '4100'}`;

  return {
    plugins: [react()],
    server: {
      // Явный IPv4: иначе Vite на Windows слушает только ::1, и часть браузеров не достучится.
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': serverUrl,
        '/auth': serverUrl,
      },
    },
  };
});
