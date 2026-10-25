import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Clock4,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api';
import { useColor } from '../colors';
import { useAction, useApi } from '../hooks';
import type { Discipline, Today } from '../types';
import { Badge, Button, Card, ErrorText } from '../ui';
import { DisciplineForm } from './Disciplines';
import { NewSemesterForm } from './Semester';
import { GooglePanel, SettingsForm } from './Settings';

const STEPS: { title: string; icon: LucideIcon; hint: string }[] = [
  {
    title: 'Время и правила',
    icon: Clock4,
    hint: 'Когда удобно учиться, когда нельзя, сколько часов в день и неделю.',
  },
  {
    title: 'Google Календарь',
    icon: CalendarDays,
    hint: 'Сервис возьмёт занятость из календаря и запишет занятия в отдельный календарь «Мой университет». Можно подключить и позже.',
  },
  {
    title: 'Дисциплины',
    icon: BookOpen,
    hint: 'Добавь то, что хочешь изучать. Для каждой — цель и как поймёшь, что достиг её.',
  },
  {
    title: 'Семестр',
    icon: CalendarPlus,
    hint: 'Даты и состав семестра. Расписание составится черновиком — его можно посмотреть до подтверждения.',
  },
];
const KEY = 'ou.setupStep';

/** Шаг мастера хранится в браузере: вход в Google уводит со страницы и возвращает обратно. */
export function storedStep(): number | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

function storeStep(step: number | null) {
  try {
    if (step === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(step));
  } catch {
    // Без хранилища мастер просто начнётся заново.
  }
}

function AddedDiscipline({ d }: { d: Discipline }) {
  const color = useColor(d.id);
  return (
    <span className="badge" style={{ gap: 6 }}>
      <span className="dot" style={{ background: color.accent }} />
      {d.name}
    </span>
  );
}

export function SetupWizard({
  today,
  step,
  setStep,
  onFinish,
}: {
  today: Today;
  step: number;
  setStep: (step: number) => void;
  onFinish: () => void;
}) {
  const { data: disciplines } = useApi<Discipline[]>('/api/disciplines');
  const { run, error } = useAction();
  const go = (next: number) => {
    storeStep(next);
    setStep(next);
  };
  const finish = () => {
    storeStep(null);
    onFinish();
  };

  // Черновик составлен — дальше его смотрят на экране семестра.
  useEffect(() => {
    if (step === 3 && today.draftPending) finish();
  });

  const current = STEPS[step] ?? STEPS[0]!;
  const Icon = current.icon;
  const back = step > 0 && (
    <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => go(step - 1)}>
      Назад
    </Button>
  );

  return (
    <div className="stack-lg">
      <div>
        <h1>Первая настройка</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Четыре шага — и сервис составит расписание вокруг твоего календаря.
        </p>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s.title} className={`step ${i < step ? 'done' : i === step ? 'current' : ''}`}>
            {i + 1}. {s.title}
          </span>
        ))}
      </div>

      <Card
        title={current.title}
        icon={
          <span className="swatch-sm">
            <Icon size={17} />
          </span>
        }
      >
        <div className="stack-lg">
          <p className="muted">{current.hint}</p>

          {step === 0 && <SettingsForm onSaved={() => go(1)} />}

          {step === 1 && (
            <>
              <GooglePanel />
              <div className="row between">
                {back}
                <Button icon={<ArrowRight size={16} />} onClick={() => go(2)}>
                  Дальше
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {disciplines && disciplines.length > 0 && (
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone="success">добавлено {disciplines.length}</Badge>
                  {disciplines.map((d) => (
                    <AddedDiscipline key={d.id} d={d} />
                  ))}
                </div>
              )}
              <DisciplineForm
                submitLabel="Добавить дисциплину"
                onSubmit={(input) => run(() => api.post('/api/disciplines', input))}
              />
              <ErrorText error={error} />
              <div className="row between">
                {back}
                <Button
                  icon={<ArrowRight size={16} />}
                  disabled={!disciplines || disciplines.length === 0}
                  onClick={() => go(3)}
                >
                  Дальше
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <NewSemesterForm zone={today.timezone} now={today.now} />
              <div>{back}</div>
            </>
          )}
        </div>
      </Card>

      <div style={{ textAlign: 'center' }}>
        <Button variant="ghost" onClick={finish}>
          Закончить настройку позже
        </Button>
      </div>
    </div>
  );
}
