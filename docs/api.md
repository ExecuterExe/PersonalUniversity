# API сервера

Все адреса — `http://localhost:4100/api/…` (в режиме разработки интерфейс на 5173 передаёт их серверу). Ответы — JSON; моменты времени — миллисекунды Unix; ошибки — `{ error, details }` с текстом по-русски.

## Главное

| Запрос | Что делает |
|---|---|
| `GET /today` | Главный экран: сегодняшние занятия, следующее, таймер, незаписанный итог, число вопросов, «с чего продолжить». Запускает проверки |
| `GET /stats` | Статистика семестра: прогресс, посещаемость, серия, прогноз, калибровка |

## Настройки

| Запрос | Что делает |
|---|---|
| `GET /settings` | Настройки (до первой записи — значения по умолчанию) |
| `PUT /settings` | Сохранить: окна для учёбы, неудобное время, дни, буфер, лимиты, Помодоро, длина семестра |

## Дисциплины и источники

| Запрос | Что делает |
|---|---|
| `GET /disciplines[?archived=true]` | Список |
| `POST /disciplines` | Создать: название, приоритет, длительность, **цель**, **метрики** |
| `GET /disciplines/:id` | Карточка с источниками и «с чего продолжить» |
| `PATCH /disciplines/:id` | Изменить (приоритет и длительность — не во время семестра) |
| `POST /disciplines/:id/archive` | В архив |
| `POST /disciplines/:id/sources` | Добавить ссылку (`kind: link, url`) или заметку (`kind: note, note`) |
| `PATCH /sources/:id`, `DELETE /sources/:id` | Изменить или удалить источник |

## Семестр

| Запрос | Что делает |
|---|---|
| `POST /semesters/draft` | Черновик: `startDate`, `fullWeeks`, `disciplineIds` |
| `GET /semesters/draft`, `POST /semesters/draft/refresh` | Посмотреть или пересчитать черновик |
| `POST /semesters/draft/compromises/:index` | Согласиться на компромисс — черновик строится заново |
| `POST /semesters/draft/confirm` | Подтвердить — семестр начинается |
| `DELETE /semesters/draft` | Удалить черновик |
| `GET /semesters/active` | Идущий семестр: бюджет, каркас, текущая неделя |
| `POST /semesters/active/changes/preview` | «Было → станет» для `add`/`remove` дисциплины |
| `POST /semesters/active/changes/apply` | Применить (с `compromiseIndex`, если без него не помещается) |

## Расписание и занятия

| Запрос | Что делает |
|---|---|
| `GET /schedule?from=&to=` | Занятия в промежутке |
| `GET /sessions/:id` | Занятие: цель, метрики, источники, «с чего продолжить», итог |
| `POST /sessions/:id/start` | Начать (за 30 мин до начала — до конца) |
| `POST /sessions/unplanned` | Внеплановое занятие: `disciplineId` |
| `POST /sessions/:id/move` | Ручной перенос: `start`; при нарушениях — 409 со списком, `confirm: true` — применить |
| `POST /sessions/:id/skip` | Пропустить заранее |
| `POST /sessions/:id/summary` | Итог: `keyConcepts` и/или `retelling`, `continueFrom` |
| `GET /timer`, `POST /timer/pause`, `/resume`, `/finish` | Таймер Помодоро |

## Решения — вопросы сервиса

| Запрос | Что делает |
|---|---|
| `GET /decisions` | Открытые вопросы: пропуски, конфликты, калибровка, контрольные точки — с вариантами |
| `POST /decisions/:id/resolve` | Ответ: `makeup`/`leave`, `move`/`compromise`/`skip`/`keep`/`skeleton`, `accept`/`dismiss`, `ack`/`extend`/`biweekly`/`finish` |
| `POST /decisions/makeup-preview` | Итог нагрузки для нескольких отработок сразу |

## Прочее

| Запрос | Что делает |
|---|---|
| `GET /export/summaries[?format=json]` | Все итоги занятий (Markdown по умолчанию) |
| `GET /health` | Сервер жив, версия движка, есть ли ключи Google |

## Google Календарь

| Запрос | Что делает |
|---|---|
| `GET /auth/google` | Перейти ко входу в Google (открывать в обычном браузере) |
| `GET /auth/google/callback` | Сюда Google возвращает после входа; дальше — на главную с `?google=connected` |
| `GET /google/status` | Подключён ли, кто вошёл, нужен ли повторный вход, когда обновлялась занятость, последняя ошибка |
| `GET /google/calendars` | Календари и какие из них учитываются как занятость |
| `PUT /google/calendars` | Выбрать календари: `busyCalendarIds` (null — все) |
| `GET /google/busy?days=14` | Что сервис видит как занятость в ближайшие дни |
| `POST /google/sync` | Синхронизировать сейчас |
| `POST /google/disconnect` | Отключить и отозвать доступ |
