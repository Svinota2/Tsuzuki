// ============================================================
//  Настройки главного процесса (то, что не видно в интерфейсе)
//  Меняй здесь и перезапускай приложение (npm start).
// ============================================================

module.exports = {
  // Адрес Shikimori. Если сайт снова сменит домен — поменяй здесь.
  SHIKIMORI_URL: 'https://shikimori.io',

  // Shikimori просит указывать название приложения в User-Agent.
  USER_AGENT: 'Tsuzuki/1.6 (anime tracker)', // ИЗМЕНЕНО В 1.5

  // ---------- Аккаунт Shikimori (двусторонняя синхронизация) ----------
  // Создай OAuth-приложение в настройках профиля на shikimori.io
  // (приложения → добавить). Название приложения должно совпадать
  // с тем, что в User-Agent выше. Права: user_rates.
  // Полученные client_id и client_secret вставь сюда.
  // Пока строки пустые — кнопка входа в настройках не работает.
  SHIKIMORI_CLIENT_ID: '',
  SHIKIMORI_CLIENT_SECRET: '',
  SHIKIMORI_REDIRECT: 'urn:ietf:wg:oauth:2.0:oob',
  AUTH_FILE: 'shikimori-auth.bin', // токены входа (шифруются safeStorage)

  // ---------- Анонимная статистика (ИЗМЕНЕНО В 1.5: Aptabase) ----------
  // Счётчик пользователей — Aptabase (aptabase.com, серверы в ЕС).
  // Смотреть статистику: https://eu.aptabase.com → приложение «Tsuzuki».
  // Ключ приложения из Aptabase (Settings/Instructions). Пусто — статистика
  // выключена совсем, приложение никуда не ходит.
  // Отправляется только с согласия пользователя, одно событие в сутки:
  // версия, платформа, язык, число тайтлов (округлённо до десятков).
  TELEMETRY_APP_KEY: 'A-EU-5097637651',
  // Адрес приёма событий. Пусто — берётся по ключу (A-EU → eu.aptabase.com).
  // Свой сервер Aptabase (self-hosted): 'https://твой-сервер/api/v0/event'.
  TELEMETRY_URL: '',

  // ---------- Автообновление (ИЗМЕНЕНО В 1.6) ----------
  // Адрес небольшого version.json с информацией о последней версии:
  //   { "version": "1.6.0", "url": "https://…/Tsuzuki-Setup.exe",
  //     "sha256": "…", "page": "https://…/releases", "notes": "что нового" }
  // Замени НИК на свой ник на GitHub (публичный репозиторий релизов!).
  // Пусто или остался «НИК» — автообновление выключено.
  // Для проверки обновления без GitHub можно временно задать адрес через
  // переменную окружения TSUZUKI_UPDATE_URL (например, http://127.0.0.1:9450/version.json).
  // Windows: приложение раз в несколько часов проверяет файл, тихо качает установщик,
  //   сверяет SHA-256 и предлагает перезапуститься.
  // Linux: ничего не качает (установщик .exe не запустить) — открывает страницу релиза.
  UPDATE_JSON_URL: process.env.TSUZUKI_UPDATE_URL || 'https://github.com/Svinota2/Tsuzuki/releases/latest/download/version.json',
  // Куда вести на Linux, если в version.json нет поля "page":
  UPDATE_PAGE: 'https://github.com/Svinota2/Tsuzuki/releases/latest',
  // Разрешённые хосты для скачивания установщика (только https).
  // Свой сайт добавь сюда, иначе скачивание будет отклонено.
  UPDATE_ALLOWED_HOSTS: ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
  // Как часто проверять обновления в фоне, часов
  UPDATE_INTERVAL_HOURS: 6,

  // ---------- Фоновые проверки ----------
  NOTIFY_INTERVAL_HOURS: 6, // как часто в фоне проверять новые серии (трей/уведомления)

  // Токен Kodik API. Можно оставить пустым и ввести токен в «Настройках»
  // или задать переменную окружения KODIK_TOKEN.
  KODIK_TOKEN: '',

  // Публичные токены Kodik из открытой библиотеки AnimeParsers
  // (github.com/YaNesyTortiK/AnimeParsers): если свой токен не задан,
  // приложение само найдёт рабочий публичный. Общий токен может перестать
  // работать в любой момент — тогда вставь свой.
  AUTO_KODIK_TOKEN: true,
  KODIK_TOKENS_URL: 'https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json',
  KODIK_TOKEN_CACHE_FILE: 'kodik-auto-token.json', // кеш в папке данных приложения
  KODIK_TOKEN_TTL_HOURS: 12,                      // сколько часов доверять токену из кеша

  // Размер главного окна при запуске
  WINDOW: {
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    background: '#0f1115', // цвет фона, пока грузится интерфейс
  },

  // Размер окна для официальных сервисов и трейлеров
  WEB_WINDOW: {
    width: 1280,
    height: 780,
  },

  // Какие файлы считать видео при сканировании папки
  VIDEO_EXTENSIONS: ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi'],

  // Имя файла, где хранится твой список (лежит в папке данных приложения,
  // путь можно посмотреть в разделе «Настройки»).
  DATA_FILE: 'tsuzuki-data.json',

  // ---------- ДОБАВЛЕНО В 1.5: статус в Discord ----------
  // Создай приложение на https://discord.com/developers/applications,
  // скопируй Application ID сюда, а в разделе Rich Presence → Art Assets
  // загрузи логотип с именем "logo". Пусто — статус в Discord выключен.
  DISCORD_CLIENT_ID: '',
  DISCORD_LARGE_IMAGE: 'logo',
};
