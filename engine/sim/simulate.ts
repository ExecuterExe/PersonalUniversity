// Симулятор семестра: печатает расписание таблицей.
//   npm run simulate                  — все тестовые сценарии
//   npm run simulate -- free          — один сценарий
//   npm run simulate -- --file my.json [--details]  — свои дисциплины и календарь
//   (образец файла: engine/sim/semester.example.json)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import {
  buildPlan,
  DAY_PARTS,
  defaultSettings,
  formatClock,
  formatDuration,
  formatFrequency,
  formatHours,
  formatInterval,
  formatMoment,
  formatPercent,
  formatWindow,
  localInfo,
  makeCalendar,
  plural,
  SESSION_FORMS,
  WEEKDAY_SHORT,
  type BusyEvent,
  type Discipline,
  type PlanInput,
  type TimeWindow,
  type Weekday,
} from '../src/index';
import { SCENARIOS } from '../src/fixtures/scenarios';

interface FileInput {
  semester: { startDate: string; weeks: number };
  timezone: string;
  now?: string;
  settings?: {
    studyWindows?: [string, string][];
    excludedWeekdays?: Weekday[];
    bufferMinutes?: number;
    maxDailyMinutes?: number;
    maxWeeklyMinutes?: number;
  };
  disciplines: Omit<Discipline, 'id'>[];
  busy?: {
    weekly?: { weekdays: Weekday[]; from: string; to: string; title: string }[];
    oneOff?: { date: string; from: string; to: string; title: string }[];
  };
}

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

function fromFile(path: string): PlanInput {
  const data = JSON.parse(readFileSync(path, 'utf8')) as FileInput;
  const zone = data.timezone;
  const windows: TimeWindow[] = (data.settings?.studyWindows ?? []).map(([a, b]) => ({
    start: toMinutes(a),
    end: toMinutes(b),
  }));
  const base = defaultSettings(zone, windows.length > 0 ? windows : [DAY_PARTS.evening]);
  const settings = {
    ...base,
    ...(data.settings?.excludedWeekdays
      ? { excludedWeekdays: data.settings.excludedWeekdays }
      : {}),
    ...(data.settings?.bufferMinutes !== undefined
      ? { bufferMinutes: data.settings.bufferMinutes }
      : {}),
    ...(data.settings?.maxDailyMinutes !== undefined
      ? { maxDailyMinutes: data.settings.maxDailyMinutes }
      : {}),
    ...(data.settings?.maxWeeklyMinutes !== undefined
      ? { maxWeeklyMinutes: data.settings.maxWeeklyMinutes }
      : {}),
  };
  const monday = DateTime.fromISO(data.semester.startDate, { zone }).startOf('week');
  const at = (day: DateTime, clock: string) =>
    day.set({ hour: Math.floor(toMinutes(clock) / 60), minute: toMinutes(clock) % 60 });
  const busy: BusyEvent[] = [];
  for (const e of data.busy?.weekly ?? []) {
    for (let w = 0; w < data.semester.weeks; w++) {
      for (const wd of e.weekdays) {
        const day = monday.plus({ days: w * 7 + wd - 1 });
        busy.push({
          start: at(day, e.from).toMillis(),
          end: at(day, e.to).toMillis(),
          title: e.title,
          recurringId: `${e.title}/${wd}`,
        });
      }
    }
  }
  for (const e of data.busy?.oneOff ?? []) {
    const day = DateTime.fromISO(e.date, { zone });
    busy.push({ start: at(day, e.from).toMillis(), end: at(day, e.to).toMillis(), title: e.title });
  }
  return {
    semester: data.semester,
    settings,
    disciplines: data.disciplines.map((d, i) => ({ ...d, id: `d${i + 1}` })),
    busy,
    now: data.now
      ? DateTime.fromISO(data.now, { zone }).toMillis()
      : monday.minus({ days: 1 }).set({ hour: 12 }).toMillis(),
  };
}

function report(title: string, input: PlanInput, details: boolean): void {
  const { settings } = input;
  const cal = makeCalendar(input.semester, settings.timezone);
  const name = (id: string) => input.disciplines.find((d) => d.id === id)?.name ?? id;
  const lastDay = DateTime.fromMillis(cal.rangeEnd - 1, { zone: cal.zone });
  const firstDay = DateTime.fromMillis(cal.rangeStart, { zone: cal.zone });

  console.log(`\n══ ${title} ══`);
  console.log(
    `Семестр: ${firstDay.toFormat('dd.LL.yyyy')} – ${lastDay.toFormat('dd.LL.yyyy')} · ${cal.weeks} нед. · ${cal.zone}`,
  );
  const excluded = settings.excludedWeekdays.map((w) => WEEKDAY_SHORT[w]).join(', ');
  console.log(
    `Окна: ${settings.studyWindows.map(formatWindow).join(', ')} · неудобные дни: ${excluded || 'нет'} · буфер ${settings.bufferMinutes} мин · лимиты: ${formatHours(settings.maxDailyMinutes)} в день, ${formatHours(settings.maxWeeklyMinutes)} в неделю`,
  );
  console.log(
    `Дисциплины: ${input.disciplines.map((d) => `${d.name} (${d.priority === 'main' ? 'осн.' : 'доп.'}, ${formatDuration(d.durationMinutes)})`).join('; ')}`,
  );

  const started = performance.now();
  const result = buildPlan(input);
  const ms = Math.round(performance.now() - started);

  if (!result.ok) {
    console.log(`\n✗ Не получилось: ${result.failure.message}`);
    if (result.compromises.length === 0) {
      console.log('  Подходящих компромиссов не нашлось.');
    } else {
      console.log('  Что можно сделать (любой вариант):');
      for (const c of result.compromises) {
        console.log(
          `   • ${c.title} → всё помещается, самая тяжёлая неделя ${formatHours(c.peakMinutes)}`,
        );
      }
    }
    console.log(`  (расчёт: ${ms} мс)`);
    return;
  }

  const { budget, state } = result;
  console.log(
    `\nБюджет недели: ${formatHours(budget.averageMinutes)} из ${formatHours(budget.capMinutes)}` +
      ` · основные ${formatHours(budget.mainMinutes)} (${formatPercent(budget.mainMinutes / (budget.averageMinutes || 1))})` +
      ` · дополнительные ${formatHours(budget.additionalMinutes)} (${formatPercent(budget.additionalMinutes / (budget.averageMinutes || 1))})` +
      ` · резерв ${formatHours(budget.reserveMinutes)}`,
  );
  for (const item of budget.items) {
    const d = input.disciplines.find((x) => x.id === item.disciplineId)!;
    console.log(
      `   ${d.name.padEnd(26)} ${formatFrequency(item.frequency)} × ${formatDuration(d.durationMinutes)}`,
    );
  }

  console.log('\nКаркас — типичная неделя:');
  const slots = [...state.skeleton].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  for (const s of slots) {
    const total = state.sessions.filter((x) => x.skeletonSlotId === s.id).length;
    const onPlace = state.sessions.filter(
      (x) => x.skeletonSlotId === s.id && x.origin === 'skeleton',
    ).length;
    const parity =
      s.parity === undefined ? '' : s.parity === 0 ? ' (нед. 1, 3, 5…)' : ' (нед. 2, 4, 6…)';
    console.log(
      `   ${WEEKDAY_SHORT[s.weekday]}  ${formatClock(s.startMinute)}–${formatClock(s.startMinute + s.durationMinutes)}  ${name(s.disciplineId).padEnd(26)} на своём месте ${onPlace} из ${total}${parity}`,
    );
  }

  const moved = state.sessions.filter((s) => s.origin === 'moved');
  console.log(
    `\nЧерновик: ${state.sessions.length} ${plural(state.sessions.length, SESSION_FORMS)} · перенесено из-за событий: ${result.moved} · без решения: ${result.conflicts.length}`,
  );
  for (const s of moved.slice(0, details ? moved.length : 8)) {
    const week = localInfo(cal, s.start).weekIndex + 1;
    console.log(
      `   нед. ${String(week).padStart(2)}: «${name(s.disciplineId)}» ${formatMoment(s.originalStart!, cal.zone)} → ${formatMoment(s.start, cal.zone)} (${s.moveReason})`,
    );
  }
  if (!details && moved.length > 8)
    console.log(`   … и ещё ${moved.length - 8} (подробно: --details)`);
  for (const c of result.conflicts) {
    const s = state.sessions.find((x) => x.id === c.sessionId)!;
    console.log(
      `   ⚠ «${name(s.disciplineId)}» ${formatMoment(s.start, cal.zone)} — некуда перенести, нужно решение`,
    );
  }

  if (details) {
    console.log('\nВсе занятия:');
    for (const s of state.sessions) {
      const week = localInfo(cal, s.start).weekIndex + 1;
      console.log(
        `   нед. ${String(week).padStart(2)}  ${formatInterval(s.start, s.end, cal.zone)}  ${name(s.disciplineId)}`,
      );
    }
  }

  if (result.warnings.length > 0) {
    console.log('\nПредупреждения:');
    for (const w of result.warnings) console.log(`   • ${w.message}`);
  }
  console.log(`(расчёт: ${ms} мс)`);
}

const args = process.argv.slice(2);
const details = args.includes('--details');
const fileIndex = args.indexOf('--file');
if (fileIndex !== -1) {
  const path = args[fileIndex + 1];
  if (!path) throw new Error('После --file укажи путь к JSON');
  // npm запускает скрипт из папки engine — путь считаем от того места, где вызвали команду.
  report(`Файл ${path}`, fromFile(resolve(process.env.INIT_CWD ?? process.cwd(), path)), details);
} else {
  const names = args.filter((a) => !a.startsWith('--'));
  const chosen = names.length > 0 ? SCENARIOS.filter((s) => names.includes(s.name)) : SCENARIOS;
  if (chosen.length === 0) {
    console.log(`Нет такого сценария. Есть: ${SCENARIOS.map((s) => s.name).join(', ')}`);
    process.exitCode = 1;
  }
  for (const s of chosen) report(`Сценарий ${s.name}: ${s.description}`, s.input, details);
}
