# Tsuzuki — передача проекта (HANDOFF)

Состояние на 02.11.2026, версия **1.2.1**. Файл для того, кто продолжит работу
(другая нейросеть/разработчик). Написано по факту проверенного кода и сборок.

## 1. Что это

Портативное Electron-приложение под Windows: каталог и трекер аниме на базе
Shikimori, онлайн-просмотр через Kodik (озвучки/субтитры), локальный плеер,
блокировка рекламы, импорт списков из других трекеров.

- Точка входа: `src/main/main.js` (главный процесс), `src/renderer/app.js` (роутер интерфейса).
- Никаких npm-зависимостей в рантайме: только встроенные `fs`, `path`, `url`, `zlib` и Electron.
- Electron/Chromium проверенной сборки: **Electron 45.2.1 / Chromium 156.0.8078.75**.
- Данные пользователя: `%APPDATA%\Tsuzuki\tsuzuki-data.json` (JSON, версия схемы 2),
  кеш публичного токена Kodik — `%APPDATA%\Tsuzuki\kodik-auto-token.json`.
  На Linux будет `~/.config/Tsuzuki/`.

## 2. Где что лежит

| Что | Путь |
| --- | --- |
| Актуальные исходники 1.2.1 | `tsuzuki-kodik-src\` (рядом с этим файлом) |
| Собранное приложение (портативно) | `Tsuzuki-kodik\` — запуск `Tsuzuki.exe` |
| Установщик | `Tsuzuki-Setup-1.2.1.exe` |
| Портативная сборка архивом | `Tsuzuki-win-x64-kodik.zip` |
| Оригинальный Tsuzuki (без изменений) | `Tsuzuki-win-x64.zip` |
| Установленная копия на этой машине | `%LOCALAPPDATA%\Programs\Tsuzuki` |
| Данные для тестов (Windows) | `%APPDATA%\Tsuzuki\tsuzuki-data.json` |

Внутри `tsuzuki-kodik-src`:

```
src/main/          main.js (окна, IPC, Kodik, токены, adblock, импорт файлов)
                   preload.js (мост window.api), settings.js (константы),
                   adblock.js + adblock-domains.js (сетевой блокер),
                   adblock-cosmetic.js + cosmetic-rules.js (скрытие баннеров)
src/renderer/      app.js, store.js, config.js, utils.js, theme.js, custom.js,
                   index.html, player-window.html (обёртка Kodik в отдельном окне),
                   views/ (catalog, anime, watch, player, library, history,
                           calendar, stats, settings, add, services),
                   api/ (shikimori, kodik, notifications, importers),
                   styles/ (app.css, theme.css)
tools/             build-installer.nsi, test-cdp/ (скрипты проверки через CDP)
build/icon.png     иконка 512×512 для Linux-сборки
CHANGES-1.1.md, CHANGES-1.2.md, changes-1.1.diff — история правок
README.md, VIDEO-SOURCES.md — описание приложения и источников видео
HANDOFF.md         этот файл
```

## 3. Что сделано по версиям

### 1.0 (наша база)
- Kodik: онлайн-плеер с озвучками/сериями, «Продолжить просмотр», память озвучки/серии.
  Свой токен не обязателен: автоподбор публичного токена из открытой библиотеки
  AnimeParsers (список `kdk_tokns/tokens.json`), кеш 12 часов, свой токен в приоритете.
- Календарь онгоингов, статистика, ручные записи, фильтры каталога, уведомления о сериях.
- История: удаление записей и полная очистка.
- Блокировка рекламы: сетевой adblock (EasyList + RU AdList, ~55 тыс. доменов) +
  скрытие нативных баннеров по правилам RU AdList в окнах «Сервисы», блокировка popup.
- Переключатель «Показывать 18+» (Shikimori по умолчанию скрывает R+).
- Плеер Kodik в отдельном окне через локальную iframe-обёртку (прямая ссылка даёт 404).

### 1.1 (сделано Claude, проверено нами на Windows)
- Склейка сезонов одной франшизы в каталоге/библиотеке, блок «Сезоны и части» на странице тайтла.
- Импорт списков: MyAnimeList XML (.xml/.xml.gz), AniList по нику; режим «не перезаписывать».
- Чистка поиска: без клипов/рекламы/промо/тайтлов без постера, строгий поиск.
- Максимум кастомизации: темы (dark/oled/dusk/light), масштаб, размер карточек,
  скругления, ширина меню, переключатели каталога/главной/плеера (`custom.js`).
- Сортировка «Лучшие» по умолчанию (рейтинг + минимум оценок, порог настраивается).
- Реальная статистика Shikimori на странице тайтла и сравнение оценок в «Статистике».
- Чистка «Продолжить просмотр»: крестик, «Очистить», автоскрытие старого/досмотренного.

### 1.2 (сделано нами после проверки 1.1)
- Пункт 2: название тайтла в верхней панели плеера — кликабельная ссылка на страницу тайтла.
- Пункт 3: новые крупные кнопки «Смотреть онлайн» (`.btn-online`, 46px, акцентный градиент).
- Пункт 9: клик по номеру серии на странице тайтла открывает онлайн-плеер на этой серии
  и отмечает её просмотренной; двойной клик — свой локальный файл, правый клик — отметить до.
- Фикс adblock: широкие правила `||yandex.net^`, `||mail.ru^` блокировали контентные CDN —
  добавлен белый список контентных доменов.
- Версия 1.2.1, `CHANGES-1.2.md`.

## 4. Как собрать Windows-сборку (проверено)

Нужны: Node.js (для `@electron/asar`), готовый распакованный дистрибутив Electron 45.2.1
(лежит в `Tsuzuki-kodik`), NSIS 3 (makensis) — для установщика.

```powershell
# 1. app.asar из исходников
npx --yes @electron/asar pack tsuzuki-kodik-src app.asar
Copy-Item app.asar Tsuzuki-kodik\resources\app.asar -Force

# 2. портативный zip
Compress-Archive -Path Tsuzuki-kodik\* -DestinationPath Tsuzuki-win-x64-kodik.zip -Force
```

Установщик: `tools/build-installer.nsi` (NSIS 3). Важно: файл должен быть в **UTF-8 с BOM**,
иначе русский текст в окнах установщика превращается в «кракозябры». В скрипте поправить
`APPDIR` и `OutFile`, затем:

```powershell
makensis build-installer.nsi
```

Установка — per-user, без прав администратора (`$LOCALAPPDATA\Programs\Tsuzuki`),
создаются ярлыки и запись деинсталлятора. Проверка: `Tsuzuki-Setup-1.2.1.exe /S /D=C:\TsuzukiTest`.

## 5. Как проверить (CDP, без ручного клика)

Приложение запускается с отладочным портом, скрипты в `tools/test-cdp/`:

```powershell
Start-Process .\Tsuzuki-kodik\Tsuzuki.exe -ArgumentList '--remote-debugging-port=9350'
node tools\test-cdp\v11-smoke.mjs       # каталог, сезоны, настройки, статистика, continue, 18+, история, Kodik, окно плеера
node tools\test-cdp\v12-features.mjs    # темы, импорт MAL, клик по серии, кнопки онлайн
```

Важно: в скриптах поправить `PORT` (должен совпадать) и `OUT` (папка для скриншотов),
в `tsuzuki-data.json` перед прогоном сделать копию и восстановить после — тесты меняют данные.

Проверено на Windows (02.11.2026): все сценарии выше работают, ошибок в консоли нет.
Скриншоты: `tools/test-cdp/shots/` в архиве с исходниками, если сохранились.

## 6. Что осталось сделать

### 6.1 Linux-версия (пункт «сделать версию на линукс») — НЕ СДЕЛАНО

Код платформенно-независимый, специфики Windows почти нет. Собирать **на Linux**
(нативно / WSL2 / Docker / GitHub Actions): electron-builder не делает Linux-таргеты на Windows.

Проверенные факты: Electron 45.2.1 (Chromium 156.0.8078.75), зависимостей нет,
данные на Linux — `~/.config/Tsuzuki/`, `resources/app.asar` подходит без изменений.

Минимальный конфиг в `package.json` (devDeps ставить на Linux; Node >= 22.12):

```json
"devDependencies": { "electron": "45.2.1", "electron-builder": "26.18.0" },
"scripts": {
  "start": "electron .",
  "dist:linux": "electron-builder --linux AppImage deb --x64 --publish never"
},
"build": {
  "appId": "io.github.tsuzuki.app",
  "productName": "Tsuzuki",
  "asar": true,
  "npmRebuild": false,
  "files": ["src/**/*", "package.json"],
  "linux": {
    "target": ["AppImage", "deb"],
    "category": "AudioVideo",
    "executableName": "tsuzuki",
    "icon": "build/icon.png",
    "maintainer": "Tsuzuki <tsuzuki@example.com>"
  }
}
```

Быстрый smoke без Node (проверить, что код вообще стартует на Linux):

```bash
curl -LO https://github.com/electron/electron/releases/download/v45.2.1/electron-v45.2.1-linux-x64.zip
unzip -q electron-v45.2.1-linux-x64.zip -d ~/Tsuzuki-linux
cp app.asar ~/Tsuzuki-linux/resources/app.asar
mv ~/Tsuzuki-linux/electron ~/Tsuzuki-linux/tsuzuki && chmod +x ~/Tsuzuki-linux/tsuzuki
~/Tsuzuki-linux/tsuzuki            # при ошибке sandbox: --no-sandbox
# либо: sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox
```

Сборка артефактов:

```bash
sudo apt install -y build-essential libfuse2t64 xdg-utils   # Ubuntu 24.04; на 22.04 libfuse2
node -v    # >= 22.12
npm install
npx electron-builder --linux AppImage deb --x64 --publish never
# результат: dist/Tsuzuki-1.2.1.AppImage, dist/tsuzuki_1.2.1_amd64.deb
```

Подводные камни:
- AppImage: нужен FUSE 2 (`libfuse2t64`/`libfuse2`); без FUSE — `--appimage-extract-and-run`.
- Sandbox: `chrome-sandbox` должен быть `root:root 4755` (deb), у AppImage — fallback на
  user namespaces; на Ubuntu 23.10+ AppArmor может блокировать (тогда `--no-sandbox`).
- Wayland: проверить и Wayland, и X11; не форсить `--ozone-platform`, если ломается.
- Кодеки: H.264/AAC играют, HEVC/AC-3/DTS — нет (как и на Windows); fallback в системный
  плеер требует `xdg-open` + установленного mpv/vlc.
- Иконка окна для `linux-unpacked` — добавить `icon` в `BrowserWindow` (файл `build/icon.png`
  уже есть; для electron-builder `linux.icon` он подхватится автоматически).
- Шрифты: «Segoe UI»/«Consolas» на Linux нет — проверить вёрстку, при необходимости
  добавить fallback `"Noto Sans", "DejaVu Sans"` в `styles/theme.css`.
- Документация: заменить `%APPDATA%`/`C:\...` на Linux-пути, добавить раздел установки.

Чек-лист приёмки Linux: запуск без ошибок в консоли; каталог/поиск/сезоны/18+;
Kodik-плеер + окно плеера + adblock; локальный плеер (mp4/aac, позиция, автопереход);
импорт MAL/AniList/Shikimori; кастомизация; deb ставится/удаляется, иконка в меню;
данные пишутся в `~/.config/Tsuzuki`.

### 6.2 Что дотестировать на Windows

- Импорт MAL через файловый диалог и `.xml.gz` (парсер XML и запись в библиотеку
  проверены, диалог — нет; нужен реальный экспорт).
- Импорт AniList по нику (нужен открытый список и реальный ник).
- 18+ онлайн-просмотр в реальном Kodik (проверен только список озвучек/серий).
- Локальный плеер: mkv/HEVC (ожидаемо fallback в системный плеер), автопереход.

## 7. Известные ограничения

- Публичный токен Kodik — общий, может быть отозван; приложение само перезапрашивает
  список и кеширует рабочий на 12 часов. Свой токен (`support@kodikres.com`) в приоритете.
- adblock-список статический (собран 02.11.2026 из EasyList + RU AdList). Чтобы обновить,
  пересобрать `adblock-domains.js` из фильтров; косметические правила — `cosmetic-rules.js`.
- `watched` в записи — плоский список номеров серий (сезоны хранятся сквозной нумерацией).
- Установщик без подписи кода → SmartScreen предупреждает при первом запуске (нормально).
- Приложение использует Kodik (неофициальный источник) — правовые риски на пользователе.

## 8. Быстрые подсказки по коду

- Добавить раздел: `views/<имя>.js` с `render(root, params)` + маршрут в `app.js`.
- Настройки и флаги: `config.js` (значения по умолчанию) + `custom.js` (пользовательские, UI).
- Новый IPC: обработчик `ipcMain.handle` в `main.js` + метод в `preload.js` + вызов `window.api.*`.
- Новый источник видео: см. `VIDEO-SOURCES.md` (адаптеры в main, HLS, «своя ссылка»).
- Отладка интерфейса: `Tsuzuki.exe --dev` (открывает DevTools) или `--remote-debugging-port=PORT`.
- Тема/стили: `styles/theme.css` (переменные), `styles/app.css` (всё остальное), 4 темы через `data-theme`.

## 9. Аудит 1.1 → 1.2 (что исправлено по замечаниям)

Аудит кода v1.1 нашёл 5 средних/мелких проблем — исправлены в 1.2:

1. **Критично: маппинг сезонов Kodik при клике по серии.** Было `#/watch/<id>//1/<n>`
   — на озвучках с разбивкой на сезоны (и сезоном 0 — спешлы) открывалась не та серия.
   Теперь `#/watch/<id>//auto/<n>`, а `watch.js` считает плоский номер по основным
   сезонам (сезон > 0), с запасным поиском по номеру; отметка ставится после
   успешного сопоставления. Проверено на «Атаке титанов» / Animedia
   (s0: 1 спешл + s1: 25 серий): `auto/3` → S1E3, `auto/1` → S1E1.
2. **Снятие отметки серии**: Alt+клик на странице тайтла отмечает/снимает без
   перехода в плеер.
3. **Таймер клика** (320 мс) отменяется в cleanup при уходе со страницы.
4. **Гонка «Сезонов и частей»**: `disposed`-флаг, старый ответ не перерисовывает
   другую страницу.
5. **Кеш франшиз** сбрасывается при переключении «Показывать 18+».
6. **Импорт MAL**: сверка по `malId` (поле добавлено в `CARD_FIELDS`), чужие
   тайтлы больше не записываются.
7. **AniList**: понятные ошибки (пустой/приватный список, HTML-ответ, 429).
8. **`.gz`-импорт**: понятное сообщение о повреждённом архиве.
9. **Тема из бэкапа** применяется сразу (`applyCustom()` после импорта/очистки).
10. **Мелочи**: `min-width:0` для названия в шапке плеера, `shortNumber` 1500 →
    «1,5 тыс.», `USER_AGENT` 1.2, `metaAt` для ненайденных записей, версия 1.2.1.

Проверено на Windows (CDP): тесты в `tools/test-cdp/v11-smoke.mjs`,
`v12-features.mjs`, плюс отдельная проверка мультисезонного маппинга/Alt+клика
(скрипт был разовым, в архив не включён). Ошибок в консоли нет.
