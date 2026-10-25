import { useEffect } from 'react';
import { api } from '../api';
import { ErrorText } from '../components';
import { useAction, useApi } from '../hooks';
import type { Discipline, Today } from '../types';
import { DisciplineForm } from './Disciplines';
import { NewSemesterForm } from './Semester';
import { GooglePanel, SettingsForm } from './Settings';

const STEPS = ['Время и правила', 'Google Календарь', 'Дисциплины', 'Семестр'];
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

  return (
    <section>
      <h2>Первая настройка</h2>
      <div className="steps">
        {STEPS.map((title, i) => (
          <span key={title} className={i < step ? 'done' : i === step ? 'current' : ''}>
            {i + 1}. {title}
            {i < STEPS.length - 1 && ' →'}
          </span>
        ))}
      </div>

      {step === 0 && <SettingsForm onSaved={() => go(1)} />}

      {step === 1 && (
        <div className="stack">
          <p>
            Сервис возьмёт занятость из твоего календаря и запишет занятия в отдельный календарь
            «Мой университет». Можно подключить и позже.
          </p>
          <GooglePanel />
          <div>
            <button onClick={() => go(2)}>Дальше</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <p>
            Добавь дисциплины, которые хочешь изучать. Для каждой — цель и как поймёшь, что достиг
            её.
          </p>
          {disciplines && disciplines.length > 0 && (
            <p className="ok">Добавлено: {disciplines.map((d) => d.name).join(', ')}</p>
          )}
          <DisciplineForm
            submitLabel="Добавить дисциплину"
            onSubmit={(input) => run(() => api.post('/api/disciplines', input))}
          />
          <ErrorText error={error} />
          <div>
            <button disabled={!disciplines || disciplines.length === 0} onClick={() => go(3)}>
              Дальше
            </button>
          </div>
        </div>
      )}

      {step === 3 && <NewSemesterForm zone={today.timezone} now={today.now} />}

      <p>
        <button className="secondary" onClick={finish}>
          Закончить настройку позже
        </button>
      </p>
    </section>
  );
}
