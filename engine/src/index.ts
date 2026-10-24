/**
 * Движок расписания «Мой университет».
 *
 * Чистая логика: не обращается к базе, сети и системным часам — текущее время
 * передаётся снаружи. Правила и цели — в docs/methodology.md.
 */
export const ENGINE_VERSION = '0.2.0';

export * from './analytics';
export * from './budget';
export * from './build';
export * from './candidates';
export * from './changes';
export * from './compromises';
export * from './conflicts';
export * from './defaults';
export * from './expand';
export * from './format';
export * from './moves';
export * from './rhythm';
export * from './rules';
export * from './skeleton';
export * from './time';
export * from './types';
export { BusyIndex } from './busy';
