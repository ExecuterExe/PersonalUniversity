import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', 'data/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      '*.js',
      'scripts/**/*.mjs',
      'server/**/*.ts',
      'engine/sim/**/*.ts',
      'web/vite.config.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  prettier,
);
