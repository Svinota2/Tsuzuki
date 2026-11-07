# Tsuzuki 1.6.0 — Windows, Linux и Android

Каталог и трекер аниме. Каталог и статистика берутся с Shikimori, а твой список, отметки серий
и история хранятся у тебя на компьютере. Онлайн-просмотр — с Kodik (озвучки, авто-подбор публичного
токена или свой токен), свои файлы — во встроенном плеере, официальные сервисы открываются в отдельном окне.
Есть блокировка рекламы (EasyList + RU AdList), «Продолжить просмотр» и кастомизация интерфейса.

Версия для Android TV лежит в отдельном проекте `tsuzuki-tv` и использует тот же интерфейс (`src/renderer`).
Блокировка рекламы там недоступна (WebView не перехватывает сеть), остальное — как на ПК.

## Как выпустить обновление (ИЗМЕНЕНО В 1.6)

Коротко: поднять версии → собрать → `node tools/make-release.mjs` → загрузить файлы в GitHub Release.

1. **Подними версию** в трёх местах (скрипт проверит и подскажет):
   - `package.json` → `version` (например, `1.6.0`);
   - `../tsuzuki-tv-src/app/build.gradle` → `versionCode` (+1) и `versionName`;
   - `../tsuzuki-phone-src/app/build.gradle` → `versionCode` (+1) и `versionName`.
   `tools/make-release.mjs` сам поправит `APPVERSION`/`VIProductVersion` в `tools/build-installer.nsi`.
2. **Собери файлы:**
   - Windows: `npx electron-builder --win dir --x64`, затем установщик —
     `makensis tools/build-installer.nsi` (NSI должен быть UTF-8 **с BOM**);
   - Linux: `npx electron-builder --linux dir` + `.deb`/`.tar.gz` (см. ниже);
   - Android ТВ: `cd ../tsuzuki-tv-src && ./sync-www.sh && ./gradlew assembleRelease`;
   - Android телефон: `cd ../tsuzuki-phone-src && ./sync-www.sh ../tsuzuki-src ../tsuzuki-tv-src && ./gradlew assembleRelease`.
   Ключ подписи APK — всегда `tsuzuki.keystore` в проектах (тот же, что раньше).
3. **Подготовь релиз:**
   ```
   node tools/make-release.mjs --repo "твой_ник/tsuzuki-releases"
   ```
   Скрипт положит в `release/` файлы `Tsuzuki-Setup.exe`, `Tsuzuki-TV.apk`,
   `Tsuzuki-Phone.apk` и три version.json с SHA-256 и заметками.
4. **GitHub:** создай публичный репозиторий `tsuzuki-releases` → Releases →
   Draft a new release → тег `v1.6.0` → загрузи 6 файлов из `release/` → Publish.
   Ссылки `.../releases/latest/download/version.json` начнут работать сразу.
5. **Адреса** (один раз): уже вписаны `Svinota2/Tsuzuki` — в `src/main/settings.js`
   (`UPDATE_JSON_URL`, `UPDATE_PAGE`) и в `../tsuzuki-tv-src/tv-web/android-api.js`
   (`UPDATE_URL_TV`, `UPDATE_URL_PHONE`). Репозиторий должен быть ПУБЛИЧНЫМ, иначе
   анонимно файлы не скачаются; пока публичного релиза нет, приложение пишет
   «репозиторий релизов не найден» — это нормально.
6. **Проверка:** для теста обновления положи version.json с версией `9.9.9` на localhost —
   при запуске из исходников (`npm start`) разрешён `http://localhost`, файл скачается,
   SHA-256 проверится, плашка появится.

## Запуск из исходников

```
npm install
npm start          # обычный запуск
npm run dev        # с инструментами разработчика
```

## Сборка

| Система | Команда | Что получится (в папке `dist/`) |
|---|---|---|
| Linux | `npm run build:linux` | `Tsuzuki-1.2.1-x86_64.AppImage` и `Tsuzuki-1.2.1-amd64.deb` |
| Windows | `npm run build:win` | `Tsuzuki-Setup-1.2.1.exe` (собирать на Windows) |

### Установка на Linux

- **.deb** (Ubuntu, Debian, Mint): `sudo apt install ./Tsuzuki-1.2.1-amd64.deb`. Tsuzuki появится в меню приложений.
- **Портативно (tar.gz)**: распакуй архив, `chmod +x tsuzuki`, запусти `./tsuzuki`.
- **AppImage** (если собрать на Linux): `npm run build:linux`, затем `chmod +x` и запуск.
  На Ubuntu 22.04+ может понадобиться `sudo apt install libfuse2`.

Данные хранятся в `~/.config/Tsuzuki/tsuzuki-data.json`, на Windows — в `%APPDATA%\Tsuzuki\`.
Перенести список между компьютерами: «Настройки» → «Сохранить копию…» на одном и «Загрузить из копии…» на другом.

## Что где лежит

```
src/main/                 ← окна, файлы, запросы в интернет (Electron)
  settings.js             ← адрес Shikimori, размеры окон, расширения видео
  main.js, preload.js     ← всё, что интерфейс может попросить у системы (window.api)
src/renderer/             ← интерфейс (общий с Android TV)
  config.js               ← ★ главные настройки: статусы, сервисы, каталог, плеер
  custom.js               ← пункты раздела «Внешний вид и поведение»
  styles/theme.css        ← ★ цвета и темы
  api/shikimori.js        ← запросы к Shikimori
  api/importers.js        ← импорт из MyAnimeList и AniList
  views/                  ← экраны: каталог, тайтл, библиотека, плеер, статистика…
build/icon.png            ← значок приложения
```

После правок в `src/renderer` нажми Ctrl+R в окне приложения, после правок в `src/main` перезапусти его.
## Что нового в 1.6.0

Подробно — `CHANGES-1.6.md`. Главное:

- **Автообновление доделано**: SHA-256 скачанного установщика, https + белый список
  хостов, на Linux вместо .exe открывается страница релиза, выключатель
  «Проверять обновления автоматически» реально останавливает фоновую проверку,
  после тихой установки приложение запускается само и показывает «Tsuzuki обновлён до X»;
  на экране «Обновления» — все статусы и кнопки «Перезапустить»/«Скачать».
- **Android**: отдельные адреса version.json для ТВ и телефона, SHA-256 APK
  проверяется в `NativeBridge.downloadAndInstall` до открытия установщика.
- **`tools/make-release.mjs`**: готовит `release/` (постоянные имена файлов,
  три version.json с sha256) и синхронизирует версию с `build-installer.nsi`.
- **Политика**: добавлен пункт про проверку обновлений на GitHub.

## Что нового в 1.5.0

Подробно — `CHANGES-1.5.md`.

- **Итоги года**: `views/recap.js` (`#/recap`), статистика по дням — `store.js` → `countDay`;
  картинка 1080×1920 / 1080×1080 → PNG.
- **Статус в Discord** (ПК, свои файлы): `main/extras.js`; включить — `DISCORD_CLIENT_ID`
  в `src/main/settings.js` + пункт в «Внешний вид и поведение».
- **Автораскладка папки с аниме**: `views/autoscan.js` (`#/autoscan`), очистка названий —
  `cleanFolderName`, оценка совпадения — `scoreCandidate`.
- **Android**: фоновые уведомления (`EpisodesChecker.java`, `EpisodesWorker.java`),
  обновление из приложения (FileProvider), общий `android-api.js` для ТВ и телефона.

## Что нового в 1.4.0

- **Анимации**: `styles/app.css` (блок «ПЛАВНЫЕ АНИМАЦИИ»), `app.js` → `animateEnter()`
  (класс `view-enter` на `#view` при каждом переходе).
- **Люди**: `views/people.js`, `#/people` и `#/people/<id>`; API —
  `api/shikimori.js` → `findUsers`, `getUser`, `getUserFriends`, `getUserHistory`,
  `getUserRates`, `getUserFavourites`.
- **Достижения**: `achievements.js` (список и проверки), `store.js` → `setAchievements`,
  `app.js` → `runAchievements`, экран в `views/stats.js`.
- **Рулетка**: `components/roulette.js`, кнопки в `views/library.js` и `views/discover.js`;
  история последних — `store.pushRoulette`.
- **Заметки и подборки**: `store.js` → `setNote`, `createCollection`, `renameCollection`,
  `deleteCollection`, `toggleCollectionItem`; UI в `views/anime.js` и `views/library.js`.
- **Субтитры**: `main.js` → `findSubtitles` / `srtToVtt` / `assToVtt` / `readSubtitles`,
  IPC `subtitles:find` и `subtitles:read`; `views/player.js` — выбор дорожки и сдвиг.
- **Телефон**: `tsuzuki-phone-src/phone-web/phone.css` — нижнее меню, крупные кнопки,
  долгое нажатие на серию (`views/anime.js` → `bindLongPress`).

## Что нового в 1.3.0

- **Аккаунт Shikimori**: вход по OAuth2 и двусторонняя синхронизация отметок,
  статусов и оценок (очередь изменений, конфликты по времени). Настройки:
  `SHIKIMORI_CLIENT_ID` / `SHIKIMORI_CLIENT_SECRET` в `src/main/settings.js`.
  Модули: `main/services.js`, `api/shikimori-sync.js`, блок в `views/settings.js`.
- **Автообновление**: чтение `version.json` (`settings.UPDATE_JSON_URL`), тихая
  загрузка установщика и перезапуск. `main/services.js` → «Автообновление».
- **Анонимная статистика** (по желанию, выключена по умолчанию):
  `api/telemetry.js`, экран согласия при первом запуске, блок
  «Конфиденциальность» в настройках. Счётчик — Aptabase (`settings.TELEMETRY_APP_KEY`),
  цифры смотреть на https://eu.aptabase.com (приложение «Tsuzuki»).
- **«Для тебя»**: рекомендации по жанрам/студиям любимых тайтлов и похожим
  с Shikimori — `views/discover.js`, маршрут `#/discover`.
- **Фон и уведомления**: трей, сворачивание в трей, автозапуск, фоновые проверки
  новых серий с системными уведомлениями — `main/background.js`.
- Android: `applicationId` оставлен прежним (`local.anidesk.tv`) ради обновления
  поверх старой версии; перенос старого файла данных в `NativeBridge.dataFile()`;
  баннер и иконки перерисованы.

## Что нового в 1.2.2

- «Политика конфиденциальности» в приложении: «Настройки» → «О приложении» →
  «Политика конфиденциальности» (маршрут `#/privacy`, файл `views/privacy.js`).
  Текст взят из `Политика конфиденциальности Tsuzuki.docx`.
- Установщик Windows оформлен в тёмной теме приложения: свои картинки окна
  (`build/installer/`), тёмный фон и заголовок, значок приложения.
- Установщик при повторном запуске обновляет Tsuzuki на месте, а если стоит
  старый AniDesk — обновляет его до Tsuzuki и убирает старую установку.
- Собран отдельный APK для телефона (`tsuzuki-phone-src`) с раскладкой под
  узкий экран (`phone.css`), телефон работает и в портрете, и в альбоме.

## Что нового в 1.2.1

- Восстановлены онлайн-просмотр Kodik (озвучки и серии), авто-подбор публичного токена и свой токен.
- Восстановлены блокировка рекламы (EasyList + RU AdList) и «Продолжить просмотр».
- Приложение переименовано в Tsuzuki; данные старой версии (AniDesk) переносятся автоматически.
- Календарь с настоящими постерами, подтверждения в стиле приложения, логотип — кнопка «на главную».
- Клик по серии открывает её в плеере и отмечает; Alt+клик — снять/поставить; название в плеере кликабельно.

## Возможности 1.1

Что добавлено и где это править:

| Что | Где в коде |
|---|---|
| Сезоны одной франшизы склеиваются в одну карточку («+N частей») в каталоге и библиотеке; на странице тайтла блок «Сезоны и части» с переключателем «OVA и спешлы» | `views/catalog.js` → `stackItems`, `views/library.js` → `stack`, `views/anime.js` → `seasonsHtml`, `api/shikimori.js` → `getFranchise` |
| Чистый поиск: без клипов, рекламы, промо, тайтлов без постера; строгий поиск (только где есть все слова) | `api/shikimori.js` → `cleanList`, переключатели в `config.js` |
| Сортировка «Лучшие»: высокий рейтинг + не меньше `MIN_VOTES` оценок; число оценок на карточке | `api/shikimori.js` → `searchAnimes`, `config.js` → `MIN_VOTES` |
| Статистика Shikimori на странице тайтла (распределение оценок, сколько людей смотрит/бросило) и сравнение твоих оценок с Shikimori в «Статистике» | `views/anime.js` → `shikiStatsHtml`, `views/stats.js` |
| Импорт из других программ: файл MyAnimeList (.xml/.xml.gz — MAL, Shikimori, Kitsu и др.) и AniList по нику | `api/importers.js`, кнопки в `views/settings.js` |
| «Продолжить просмотр»: крестик на карточке, «Очистить», автоскрытие досмотренного и старого | `store.js` → `getContinueWatching`, `hideContinue`, `clearContinue` |
| «Внешний вид и поведение» в настройках: тема (тёмная, OLED, сине-серая, светлая), масштаб, размер карточек, скругления, меню и все переключатели выше | `custom.js` → `OPTIONS` (добавь строчку — появится новый пункт), темы в `styles/theme.css` |

При первом запуске после обновления приложение само дозапросит у Shikimori франшизу и оценку для старых записей (нужно для склейки сезонов и статистики) — это несколько секунд в фоне.
