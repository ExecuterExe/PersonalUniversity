import {
  ArrowUpRight,
  BookOpen,
  Check,
  Gift,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAction, useApi } from '../hooks';
import { useConfirm } from '../confirm';
import type { StudyAward, StudyProgress } from '../types';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorText,
  Loading,
  PageHeader,
  Progress,
  Segmented,
} from '../ui';

function Choices({
  award,
  busy,
  choose,
}: {
  award: StudyAward;
  busy: boolean;
  choose: (index: number) => void;
}) {
  return (
    <div className="reward-choices">
      {award.offers.map((offer, index) => (
        <button
          type="button"
          key={offer.id}
          className="reward-choice"
          disabled={busy}
          onClick={() => choose(index)}
        >
          <Gift size={21} />
          <strong>{offer.title}</strong>
        </button>
      ))}
    </div>
  );
}

function AwardDialog({ award, rewardsEnabled }: { award: StudyAward; rewardsEnabled: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { run, error, busy } = useAction();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () =>
    void run(() => api.post(`/api/progress/awards/${encodeURIComponent(award.id)}/acknowledge`));
  const chosen =
    !rewardsEnabled || award.chosenIndex === null ? null : award.offers[award.chosenIndex];
  const hasOffers = rewardsEnabled && award.offers.length > 0;
  return (
    <dialog
      ref={ref}
      className="award-dialog"
      aria-labelledby="award-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="award-dialog-body">
        <span className="award-emblem">
          <Trophy size={32} />
        </span>
        <p className="eyebrow">Занятие завершено · {award.disciplineName}</p>
        <h2 id="award-title">+{award.xp} опыта</h2>
        {award.unlocked.map((item) => (
          <div className="award-new-rank" key={item.level}>
            <Badge tone="violet">Уровень {item.level}</Badge>
            <strong>{item.title}</strong>
          </div>
        ))}
        {award.quality && (
          <div className="quality-find">
            <span>Новое слово в коллекции</span>
            <strong>{award.quality.word}</strong>
          </div>
        )}
        {award.qualityOutcome === 'complete' && (
          <p className="quality-miss">Все 500 слов уже в твоей коллекции!</p>
        )}
        {!hasOffers ? null : chosen ? (
          <div className="award-chosen">
            <Gift size={25} />
            <strong>{chosen.title}</strong>
            <p>{award.usedAt ? 'Отмечено как использованное' : 'В копилке'}</p>
          </div>
        ) : (
          <>
            <p className="muted">Выбери награду</p>
            <Choices
              award={award}
              busy={busy}
              choose={(index) =>
                void run(() =>
                  api.post(`/api/progress/awards/${encodeURIComponent(award.id)}/choose`, {
                    index,
                  }),
                )
              }
            />
          </>
        )}
        <ErrorText error={error} />
        <div className="row" style={{ justifyContent: 'center' }}>
          {chosen && !award.usedAt && (
            <Button
              icon={<Check size={16} />}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.post(`/api/progress/awards/${encodeURIComponent(award.id)}/use`);
                  await api.post(
                    `/api/progress/awards/${encodeURIComponent(award.id)}/acknowledge`,
                  );
                })
              }
            >
              Использовать сейчас
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={close}>
            {chosen && !award.usedAt
              ? 'Оставить на потом'
              : hasOffers && !chosen
                ? 'Выберу позже'
                : 'Готово'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export function ProgressNotice({ data }: { data?: StudyProgress }) {
  return data?.pending ? (
    <AwardDialog key={data.pending.id} award={data.pending} rewardsEnabled={data.rewardsEnabled} />
  ) : null;
}

function levelXp(data: StudyProgress) {
  return data.nextLevelXp === null
    ? 'Все уровни открыты'
    : `${data.xp - data.levelFloor} / ${data.nextLevelXp - data.levelFloor} XP`;
}

export function ProgressMini({ data, today = false }: { data?: StudyProgress; today?: boolean }) {
  if (!data) return null;
  const fraction =
    data.nextLevelXp === null
      ? 1
      : (data.xp - data.levelFloor) / (data.nextLevelXp - data.levelFloor);
  return (
    <a
      className={today ? 'study-mini today-level' : 'study-mini'}
      href="#progress"
      aria-label={`Уровень ${data.level}, ${data.title}. ${levelXp(data)}. Открыть прогресс`}
    >
      <span>
        <Trophy size={16} />
        <strong>Уровень {data.level}</strong>
        <small>{levelXp(data)}</small>
      </span>
      <span className="study-mini-title">{data.title}</span>
      <Progress value={fraction} label="Опыт до следующего уровня" />
    </a>
  );
}

function RewardOption({ option }: { option: StudyProgress['options'][number] }) {
  const [title, setTitle] = useState(option.title);
  const { run, error, busy } = useAction();
  const confirm = useConfirm();
  return (
    <div className={`reward-option ${option.enabled ? '' : 'is-disabled'}`}>
      <label className="row">
        <input
          type="checkbox"
          checked={option.enabled}
          disabled={busy}
          onChange={(e) =>
            void run(() =>
              api.patch(`/api/progress/rewards/${encodeURIComponent(option.id)}`, {
                enabled: e.target.checked,
              }),
            )
          }
          aria-label={`Включить награду: ${option.title}`}
        />
        <span>{option.enabled ? 'В наборе' : 'Отключена'}</span>
      </label>
      <div className="row">
        <input
          className="input grow"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={`Название награды: ${option.title}`}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !title.trim() || title.trim() === option.title}
          onClick={() =>
            void run(() =>
              api.patch(`/api/progress/rewards/${encodeURIComponent(option.id)}`, { title }),
            )
          }
        >
          Сохранить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 size={15} />}
          aria-label={`Удалить награду: ${option.title}`}
          disabled={busy}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Удалить «${option.title}»?`,
                text: 'Пункт исчезнет из набора будущих наград. Уже заработанные варианты в копилке сохранятся.',
                ok: 'Удалить',
                danger: true,
              }))
            )
              return;
            await run(() => api.del(`/api/progress/rewards/${encodeURIComponent(option.id)}`));
          }}
        />
      </div>
      <ErrorText error={error} />
    </div>
  );
}

function ProgressSettings({ data, onClose }: { data: StudyProgress; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const { run, error, busy } = useAction();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="progress-settings-dialog"
      aria-labelledby="progress-settings-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="progress-settings-head">
        <div>
          <span className="eyebrow">Прогресс</span>
          <h2 id="progress-settings-title">Настройки</h2>
        </div>
        <Button
          variant="ghost"
          icon={<X size={19} />}
          aria-label="Закрыть настройки прогресса"
          onClick={onClose}
        />
      </div>
      <div className="progress-settings-body">
        <div className="progress-setting-toggle">
          <span className="progress-setting-icon">
            <BookOpen size={19} />
          </span>
          <label className="grow" htmlFor="progress-words-enabled">
            <strong>Коллекция слов</strong>
            <span>50% шанс на новое слово после занятия</span>
          </label>
          <input
            id="progress-words-enabled"
            type="checkbox"
            aria-label="Находки слов включены"
            checked={data.qualitiesEnabled}
            disabled={busy}
            onChange={(e) =>
              void run(() =>
                api.put('/api/progress/preferences', { qualitiesEnabled: e.target.checked }),
              )
            }
          />
        </div>
        <div className="progress-setting-toggle">
          <span className="progress-setting-icon">
            <Gift size={19} />
          </span>
          <label className="grow" htmlFor="progress-rewards-enabled">
            <strong>Приятные награды</strong>
            <span>Выбор награды и копилка на потом</span>
          </label>
          <input
            id="progress-rewards-enabled"
            type="checkbox"
            aria-label="Приятные награды включены"
            checked={data.rewardsEnabled}
            disabled={busy}
            onChange={(e) =>
              void run(() =>
                api.put('/api/progress/preferences', { rewardsEnabled: e.target.checked }),
              )
            }
          />
        </div>
        <ErrorText error={error} />
        <section className="progress-reward-editor" aria-labelledby="reward-list-title">
          <div className="row between">
            <h3 id="reward-list-title">Твой набор наград</h3>
            <span className="faint">{data.options.filter((o) => o.enabled).length} включено</span>
          </div>
          {!data.rewardsEnabled && (
            <p className="faint">
              Предложения отключены. Набор можно редактировать, заработанное сохранено.
            </p>
          )}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.post('/api/progress/rewards', { title })).then((saved) => {
                if (saved) setTitle('');
              });
            }}
          >
            <input
              aria-label="Новая награда"
              className="input grow"
              maxLength={120}
              placeholder="Например: серия аниме"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button type="submit" icon={<Plus size={16} />} disabled={busy || !title.trim()}>
              Добавить
            </Button>
          </form>
          <div className="progress-reward-options">
            {data.options.map((option) => (
              <RewardOption key={option.id + option.title} option={option} />
            ))}
          </div>
          {!data.options.length && (
            <p className="faint">Добавь то, чем тебе приятно себя порадовать.</p>
          )}
          <p className="faint">Изменения набора действуют на будущие занятия.</p>
        </section>
        <details className="progress-rules">
          <summary>Как начисляется прогресс</summary>
          <ul>
            <li>
              100 опыта за новый итог занятия с хотя бы минутой чистой учёбы. Длина записи не важна.
            </li>
            <li>
              Слова выпадают с шансом 50%, без повторов. Результат не меняется при обновлении
              страницы.
            </li>
            <li>Предлагаются до двух приятных наград — выбираешь одну, сейчас или позже.</li>
            <li>
              Опыт, слова и заработанные награды сохраняются между семестрами. Пропуски ничего не
              отнимают.
            </li>
            <li>Старые итоги не начисляют опыт и слова задним числом.</li>
          </ul>
        </details>
      </div>
      <div className="progress-settings-foot">
        <span className="faint">Собранное сохранится и при отключении.</span>
        <Button onClick={onClose}>Готово</Button>
      </div>
    </dialog>
  );
}

function QualityCollection({ data, onSettings }: { data: StudyProgress; onSettings: () => void }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('new');
  const [shown, setShown] = useState(24);
  const query = search.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const words = data.collection.filter((w) =>
    w.word.toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(query),
  );
  if (sort === 'alphabet') words.sort((a, b) => a.word.localeCompare(b.word, 'ru'));
  return (
    <Card
      className="progress-content"
      title="Коллекция слов"
      icon={<Sparkles size={19} color="var(--violet)" />}
      action={
        <span className="progress-section-meta">
          {data.collection.length} / {data.collectionSize}
        </span>
      }
    >
      <div className="stack">
        <div className="row between">
          <span className="faint">
            {data.qualitiesEnabled
              ? 'Новое слово с шансом 50% после занятия'
              : 'Находки отключены · коллекция сохранена'}
          </span>
          {!data.qualitiesEnabled && (
            <Button variant="ghost" size="sm" onClick={onSettings}>
              Включить
            </Button>
          )}
        </div>
        {data.collection.length > 0 ? (
          <>
            <div className="progress-collection-tools">
              <div className="practice-search">
                <Search size={17} />
                <input
                  aria-label="Поиск в коллекции"
                  placeholder="Найти слово"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShown(24);
                  }}
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Очистить поиск слов"
                    onClick={() => {
                      setSearch('');
                      setShown(24);
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <select
                aria-label="Порядок слов"
                className="select"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setShown(24);
                }}
              >
                <option value="new">Сначала новые</option>
                <option value="alphabet">По алфавиту</option>
              </select>
            </div>
            <div className="quality-grid">
              {words.slice(0, shown).map((w) => (
                <div
                  className={`quality-card quality-tone-${w.id % 4}`}
                  key={w.id}
                  title={`Найдено ${new Date(w.foundAt).toLocaleDateString('ru-RU')}`}
                >
                  <Sparkles size={16} />
                  <strong>{w.word}</strong>
                </div>
              ))}
            </div>
            {!words.length && (
              <div className="progress-small-empty">
                <Search size={23} />
                <strong>Такого слова пока нет</strong>
                <span>Попробуй другой запрос.</span>
              </div>
            )}
            {words.length > shown && (
              <Button variant="ghost" onClick={() => setShown((v) => v + 24)}>
                Показать ещё
              </Button>
            )}
          </>
        ) : (
          <div className="progress-collection-empty">
            <div className="progress-empty-orbit">
              <Sparkles size={30} />
            </div>
            <h3>Твоя коллекция начинается здесь</h3>
            <p>Сохрани итог занятия. Первая находка может стать твоей.</p>
            <div className="progress-mystery-words" aria-hidden="true">
              <span>?</span>
              <span>?</span>
              <span>?</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Wallet({ data, onSettings }: { data: StudyProgress; onSettings: () => void }) {
  const [tab, setTab] = useState<'available' | 'used'>('available');
  const [shown, setShown] = useState(10);
  const { run, error, busy } = useAction();
  const rows = tab === 'available' ? data.wallet : data.used;
  return (
    <Card
      title="Твои награды"
      className="progress-content"
      icon={<Gift size={20} color="var(--primary)" />}
      action={
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v);
            setShown(10);
          }}
          options={[
            { value: 'available', label: `Доступные · ${data.wallet.length}` },
            { value: 'used', label: 'Использованные' },
          ]}
        />
      }
    >
      <div className="stack">
        <ErrorText error={error} />
        {!rows.length ? (
          <Empty
            icon={<Gift size={28} />}
            title={tab === 'available' ? 'Награды ещё впереди' : 'Пока нет использованных наград'}
          >
            {tab === 'available'
              ? 'Заработанные награды появятся здесь после занятия.'
              : 'Здесь будут награды, которые ты уже использовал.'}
          </Empty>
        ) : (
          rows.slice(0, shown).map((award) => (
            <article className="wallet-item" key={award.id}>
              <div className="row between">
                <span className="faint">
                  {award.disciplineName} · {new Date(award.createdAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
              {award.chosenIndex === null ? (
                <Choices
                  award={award}
                  busy={busy}
                  choose={(index) =>
                    void run(() =>
                      api.post(`/api/progress/awards/${encodeURIComponent(award.id)}/choose`, {
                        index,
                      }),
                    )
                  }
                />
              ) : (
                <div className="row between">
                  <strong>{award.offers[award.chosenIndex]?.title}</strong>
                  {award.usedAt ? (
                    <Badge>Использована</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.post(`/api/progress/awards/${encodeURIComponent(award.id)}/use`),
                        )
                      }
                    >
                      Использовать
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))
        )}
        {rows.length > shown && (
          <Button variant="ghost" onClick={() => setShown((n) => n + 10)}>
            Показать ещё
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<Settings2 size={14} />} onClick={onSettings}>
          Настроить набор наград
        </Button>
        {tab === 'used' && rows.length >= 20 && (
          <p className="faint">Показаны последние 20 использованных наград.</p>
        )}
      </div>
    </Card>
  );
}

export function ProgressScreen() {
  const { data, error } = useApi<StudyProgress>('/api/progress');
  const { run, error: actionError, busy } = useAction();
  const [tab, setTab] = useState<'words' | 'rewards' | 'ranks'>('words');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const header = (
    <PageHeader
      title="Прогресс"
      icon={<Trophy size={24} />}
      actions={
        <Button
          variant="secondary"
          icon={<Settings2 size={17} />}
          onClick={() => setSettingsOpen(true)}
          disabled={!data}
        >
          Настройки
        </Button>
      }
    />
  );
  if (!data)
    return (
      <>
        {header}
        <Loading error={error} />
      </>
    );
  const fraction =
    data.nextLevelXp === null
      ? 1
      : (data.xp - data.levelFloor) / (data.nextLevelXp - data.levelFloor);
  const tabs = [
    {
      id: 'words' as const,
      label: 'Коллекция',
      count: data.collection.length,
      icon: <Sparkles size={16} />,
    },
    {
      id: 'rewards' as const,
      label: 'Награды',
      count: data.rewardsEnabled ? data.wallet.length : 'выкл.',
      icon: <Gift size={16} />,
    },
    {
      id: 'ranks' as const,
      label: 'Звания',
      count: data.unlocked.length,
      icon: <Trophy size={16} />,
    },
  ];
  return (
    <div className="progress-home">
      {header}
      <ErrorText error={error} />
      <section className="progress-profile" aria-label="Твой уровень">
        <div className="progress-profile-top">
          <div className="progress-profile-emblem">
            <Trophy size={31} />
            <span>{data.level}</span>
          </div>
          <div className="grow">
            <div className="progress-profile-kicker">Уровень {data.level} из 50</div>
            <h2>{data.title}</h2>
            <p>
              Всего {data.xp} XP <span>·</span> Занятий с опытом: {data.lessons}
            </p>
          </div>
          <button type="button" className="progress-title-link" onClick={() => setTab('ranks')}>
            Сменить звание <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="progress-profile-bottom">
          {data.nextLevelXp !== null && <strong className="level-local-xp">{levelXp(data)}</strong>}
          <Progress value={fraction} label="Прогресс уровня" />
          <span>
            {data.nextLevelXp === null
              ? 'Все уровни открыты'
              : `До уровня ${data.level + 1} — ${data.nextLevelXp - data.xp} XP`}
          </span>
        </div>
      </section>
      <div className="progress-view-tabs" role="group" aria-label="Раздел прогресса">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
            <small>{item.count}</small>
          </button>
        ))}
      </div>
      <div className="progress-active-view">
        {tab === 'words' && (
          <QualityCollection data={data} onSettings={() => setSettingsOpen(true)} />
        )}
        {tab === 'rewards' &&
          (data.rewardsEnabled ? (
            <Wallet data={data} onSettings={() => setSettingsOpen(true)} />
          ) : (
            <Card className="progress-content">
              <Empty
                icon={<Gift size={29} />}
                title="Приятные награды отключены"
                action={
                  <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                    Настроить награды
                  </Button>
                }
              >
                Заработанное сохранено. Включить предложения можно в настройках.
              </Empty>
            </Card>
          ))}
        {tab === 'ranks' && (
          <Card
            className="progress-content"
            title="Открытые звания"
            icon={<Trophy size={19} color="var(--primary)" />}
            action={<span className="progress-section-meta">{data.unlocked.length} / 50</span>}
          >
            <div className="stack">
              <div className="row between">
                <span className="faint">Выбери звание для профиля</span>
                <button
                  type="button"
                  className="progress-auto-title"
                  aria-pressed={!data.titlePinned}
                  disabled={busy}
                  onClick={() => void run(() => api.put('/api/progress/title', { level: 0 }))}
                >
                  <Check size={14} />
                  Последнее открытое
                </button>
              </div>
              <ErrorText error={actionError} />
              <div className="study-ranks">
                {data.unlocked.map((rank) => (
                  <button
                    type="button"
                    className={`study-rank ${data.titleLevel === rank.level ? 'is-current' : ''}`}
                    key={rank.level}
                    disabled={busy}
                    aria-label={`Выбрать звание: ${rank.title}`}
                    aria-pressed={data.titleLevel === rank.level}
                    onClick={() =>
                      void run(() => api.put('/api/progress/title', { level: rank.level }))
                    }
                  >
                    <span>{rank.level}</span>
                    <strong>{rank.title}</strong>
                    {data.titleLevel === rank.level && <Check size={16} />}
                  </button>
                ))}
                {data.level < 50 && (
                  <div className="study-rank is-locked">
                    <span>?</span>
                    <strong>Следующее звание — на уровне {data.level + 1}</strong>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
      {settingsOpen && <ProgressSettings data={data} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
