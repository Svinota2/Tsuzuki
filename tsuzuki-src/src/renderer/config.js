// ============================================================
//  НАСТРОЙКИ ИНТЕРФЕЙСА — самое удобное место, чтобы что-то подкрутить.
//  Поменял — нажми Ctrl+R в приложении (перезагрузка интерфейса).
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - новые настройки: HIDE_JUNK_KINDS, HIDE_NO_POSTER, HIDE_ANONS, STRICT_SEARCH, MIN_VOTES, SHOW_VOTES, STACK_FRANCHISES, SHOW_NEWS, SHOW_CONTINUE, CONTINUE_*, SHOW_SIDEBAR_STATS
//  - сортировка top («Лучшие») по умолчанию
// ------------------------------------------------------------

export const CONFIG = {
  // ---------- Каталог ----------
  PAGE_SIZE: 30,              // сколько аниме грузить за раз (Shikimori отдаёт максимум 50)
  DEFAULT_ORDER: 'top',       // сортировка по умолчанию (варианты ниже, в ORDERS)
  HIDE_18_PLUS: true,         // скрывать 18+ по умолчанию (показ включается в «Настройках»)
  SEARCH_DELAY_MS: 400,       // пауза после ввода в поиск, прежде чем отправить запрос

  // Чистка каталога и поиска
  HIDE_JUNK_KINDS: true,      // прятать клипы, рекламу и промо-ролики (их можно выбрать в фильтре «Тип» вручную)
  JUNK_KINDS: ['music', 'cm', 'pv'],
  HIDE_NO_POSTER: true,       // прятать тайтлы без постера (обычно пустые карточки)
  HIDE_ANONS: false,          // прятать анонсы (ещё не вышедшее)
  STRICT_SEARCH: true,        // в поиске оставлять только тайтлы, где есть ВСЕ слова запроса

  // «Лучшие»: высокий рейтинг И много оценок
  MIN_VOTES: 2000,            // меньше оценок — тайтл в «Лучших» не показываем
  SHOW_VOTES: true,           // показывать число оценок на карточке

  // Сезоны одной франшизы показывать одной карточкой (в каталоге и библиотеке)
  STACK_FRANCHISES: true,

  // Блоки на главной
  SHOW_NEWS: true,            // «Вышли новые серии»
  SHOW_CONTINUE: true,        // «Продолжить просмотр»
  CONTINUE_LIMIT: 6,          // сколько карточек в «Продолжить просмотр»
  CONTINUE_MAX_DAYS: 60,      // не показывать то, что открывал больше N дней назад (0 — без ограничения)
  CONTINUE_HIDE_COMPLETED: true, // не показывать тайтлы со статусом «Просмотрено»
  SHOW_SIDEBAR_STATS: true,   // счётчики внизу бокового меню

  // ---------- Плеер ----------
  AUTO_MARK_PERCENT: 90,      // на скольких % серии отмечать её просмотренной
  AUTOPLAY_NEXT: true,        // включать следующую серию сама
  DISCORD_PRESENCE: false,    // ДОБАВЛЕНО В 1.5: статус в Discord (ПК); нужен DISCORD_CLIENT_ID в src/main/settings.js
  DISCORD_PRESENCE_BROWSE: true, // ДОБАВЛЕНО В 1.6.2: показывать в статусе раздел и открытый тайтл, а не только плеер
  SEEK_STEP_SEC: 10,          // на сколько секунд перематывать стрелками
  SAVE_POSITION_EVERY_SEC: 5, // как часто запоминать, где остановился

  // ---------- Итоги года (ДОБАВЛЕНО В 1.5) ----------
  RECAP_DEFAULT_EPISODE_MIN: 24, // длительность серии, если Shikimori её не знает (мин)

  // ---------- Трекер ----------
  // true — статусы меняются сами: отметил первую серию → «Смотрю»,
  // отметил последнюю → «Просмотрено»
  AUTO_STATUS: true,

  // Статусы списка. id не меняй (они совпадают с Shikimori), а label и color — сколько угодно.
  STATUSES: [
    { id: 'watching',  label: 'Смотрю',       color: '#4ade80' },
    { id: 'planned',   label: 'В планах',     color: '#60a5fa' },
    { id: 'completed', label: 'Просмотрено',  color: '#a78bfa' },
    { id: 'on_hold',   label: 'Отложено',     color: '#fbbf24' },
    { id: 'dropped',   label: 'Брошено',      color: '#f87171' },
  ],

  // ---------- Официальные сервисы ----------
  // home — что открывается во вкладке «Сервисы»
  // search — поиск тайтла с карточки аниме, {q} заменяется на название
  // lang: 'en' — искать по оригинальному названию (для зарубежных сервисов)
  // Добавляй свои сервисы по этому же образцу.
  SERVICES: [
    { name: 'Кинопоиск',  color: '#ff6600', home: 'https://hd.kinopoisk.ru/',      search: 'https://www.kinopoisk.ru/index.php?kp_query={q}' },
    { name: 'Okko',       color: '#6b3cff', home: 'https://okko.tv/',              search: 'https://okko.tv/search/{q}' },
    { name: 'Wink',       color: '#f9461c', home: 'https://wink.ru/',              search: 'https://wink.ru/search?query={q}' },
    { name: 'Иви',        color: '#ea003d', home: 'https://www.ivi.ru/',           search: 'https://www.ivi.ru/search/?q={q}' },
    { name: 'Crunchyroll',color: '#f47521', home: 'https://www.crunchyroll.com/',  search: 'https://www.crunchyroll.com/search?q={q}', lang: 'en' },
    { name: 'Netflix',    color: '#e50914', home: 'https://www.netflix.com/',      search: 'https://www.netflix.com/search?q={q}', lang: 'en' },
  ],

  // ---------- Подписи для фильтров (переводы значений Shikimori) ----------
  ORDERS: {
    top:        'Лучшие (рейтинг + много оценок)',
    popularity: 'По популярности',
    ranked:     'По рейтингу',
    aired_on:   'По дате выхода',
    name:       'По алфавиту',
  },
  KINDS: {
    tv: 'ТВ-сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA',
    special: 'Спешл', tv_special: 'ТВ-спешл', music: 'Клип', pv: 'Промо', cm: 'Реклама',
  },
  ANIME_STATUSES: {
    anons: 'Анонс', ongoing: 'Онгоинг', released: 'Вышло',
  },
  SEASONS: {
    winter: 'Зима', spring: 'Весна', summer: 'Лето', fall: 'Осень',
  },
  RATINGS: {
    g: 'G — для всех',
    pg: 'PG — детям',
    pg_13: 'PG-13 — 13+',
    r: 'R — 17+',
    r_17: 'R+ — 17+',
    r_plus: 'R++ — 18+',
  },

  // ---------- «Для тебя»: рекомендации (ИЗМЕНЕНО В 1.3) ----------
  DISCOVER_MIN_SCORE: 8,        // с какой оценки тайтл влияет на вкус
  DISCOVER_MIN_AVG_SCORE: 6,    // не советовать тайтлы с рейтингом ниже этого
  DISCOVER_TOP_TITLES: 10,      // сколько любимых тайтлов брать за основу
  DISCOVER_SIMILAR_EACH: 6,     // сколько похожих брать с каждого тайтла
  DISCOVER_GENRE_TOP: 3,        // сколько любимых жанров тоже подмешивать
  DISCOVER_LIMIT: 60,           // сколько карточек в подборке
  DISCOVER_CACHE_HOURS: 24,     // сколько часов жить подборке

  // ---------- Синхронизация с Shikimori (ИЗМЕНЕНО В 1.3) ----------
  SYNC_INTERVAL_MIN: 15,        // автосинхронизация раз в N минут
  SYNC_PAGE_SIZE: 100,          // размер страницы при загрузке списка
  SYNC_REQUEST_PAUSE_MS: 400,   // пауза между запросами (лимиты Shikimori)

  // ---------- Анонимная статистика и обновления (ИЗМЕНЕНО В 1.3) ----------
  TELEMETRY_ENABLED_DEFAULT: false, // статистика никогда не включается сама
  UPDATE_CHECK_HOURS: 6,            // как часто проверять обновления
};
