# Дополнительные источники видео для Tsuzuki

Разбор от 02.11.2026: какие API/источники видео для аниме существуют, что из
них живо, что реально встроить в Electron-приложение и в каком порядке.

## Что уже есть в проекте

- **Kodik** — iframe-плеер (`kodik:search` в `main.js`, `api/kodik.js`,
  `views/watch.js`). Свой токен выдаётся владельцам сайтов, но приложение
  работает и без него: берёт публичный токен из открытой библиотеки
  [AnimeParsers](https://github.com/YaNesyTortiK/AnimeParsers)
  (её же использует [Kodik-Download-Watch](https://github.com/YaNesyTortiK/Kodik-Download-Watch)).
- **Локальные файлы** — `<video>` + `file://` (`views/player.js`).
- Вся сеть уже идёт через главный процесс (`net.fetch` + IPC) — CORS не мешает,
  это готовая база для адаптеров-провайдеров.
- CSP (`index.html`) разрешает iframe только для хостов Kodik; для новых
  источников его нужно расширять точечно.

## Kodik без своего токена (уже внедрено)

`Kodik-Download-Watch` и его библиотека `AnimeParsers` не требуют токена от
пользователя: библиотека хранит список зашифрованных публичных токенов и
проверяет их перед использованием.

- Список токенов: `https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json`
  (секции `stable`, `unstable`, `legacy`, `dead`, у каждого — статусы функций).
- Шифрование: две половины токена в base64, обе перевёрнуты; в `main.js` это
  функция `decodeKodikToken`.
- В Tsuzuki: `resolveKodikToken()` — свой токен из настроек/env в приоритете,
  иначе кеш (`%APPDATA%\Tsuzuki\kodik-auto-token.json`, TTL 12 ч), иначе
  загрузка списка и проверка через `/translations`; при протухании — повторный
  подбор и один ретрай запроса.
- Что это даёт: реальный поиск по `shikimori_id`/названию, озвучки, серии,
  iframe-плеер без токена пользователя. Ограничение: публичный токен общий,
  может быть отозван; свой токен надёжнее.

Из того же проекта можно взять и **прямые ссылки Kodik** (`get_link`: mp4/HLS
`m3u8` + список качеств, `get_m3u8_playlist_link`) — это путь к встроенному
`<video>` с автопереходом серий и «продолжить с места» вместо iframe. Но ссылки
короткоживущие и подписаны, нужен Referer и свой HLS-плеер.

## Таблица источников

| Источник | Что даёт | API / эндпоинт | Авторизация | Формат | Ограничения | Риск |
| --- | --- | --- | --- | --- | --- | --- |
| **Kodik** (есть) | озвучки/сабы, сезоны, серии | `https://kodik-api.com` (`/search`, `/translations`); список публичных токенов — `AnimeParsers/kdk_tokns/tokens.json` | свой токен владельцам сайтов **или публичный (авто)** | iframe (`kodikplayer.com`); прямые mp4/HLS — через `get_link` | гео-блокировки, нужен домен плеера, публичный токен может быть отозван | высокий (пиратский контент) |
| **AniLibria** | релизы, HLS 1080/720/480, расписание, торренты | `https://anilibria.top/api/v1/` (старый `api.anilibria.tv/v3` — deprecated) | не нужна для открытых методов | прямой HLS `.m3u8` (`cache.libria.fun`) | нет официального маппинга на Shikimori-id — искать по названию | средне-высокий |
| **Anime365 / Смотрет-аниме** | каталог, переводы, ссылки на видео | `https://smotret-anime.app/api` (+ зеркала) | каталог — без токена; видео — по `access_token` | iframe/embed, прямые ссылки | токен привязан к аккаунту, зеркала/гео | средне-высокий |
| **VK Video** | трейлеры, опенинги, любительские озвучки | embed `https://vk.ru/video_ext.php?oid=…&id=…&hash=…` | для встраивания публичного — нет | iframe | только загруженное в VK; приватные — по `hash` | низкий |
| **Rutube** | официальные загрузки | embed `https://rutube.ru/play/embed/{id}` | нет | iframe | контента мало, реклама | низкий |
| **YouTube** | трейлеры/опенинги | IFrame API `youtube.com/embed/{id}` | embed — без ключа | iframe | в РФ замедлен, ToS | низкий |
| **Sibnet** | UGC-видео, аниме-озвучки | embed `video.sibnet.ru/shell.php?videoid=ID` | нет | iframe | нет каталога/поиска, антибот | средний |
| **Своя ссылка** | любой m3u8/mp4/iframe от пользователя | — | нет | HLS / mp4 / iframe | валидация схемы, хранение в JSON | зависит от источника |
| **Торренты: AniLibria / Nyaa** | полные серии, макс. качество, оффлайн | magnet из API AniLibria / RSS Nyaa | нет | magnet → WebTorrent | скорость/сиды, размер, ISP-внимание | высокий |
| **Alloha** | озвучки/серии | закрытый API + подпись (`alloha.tv/access`) | только владельцам сайтов: ≥300 посетителей/сутки, свой домен + CNAME | iframe, HLS/MP4 после подписи | тяжёлая антибот-подпись; личный проект доступ не получит | высокий |
| **VideoCDN** | контент-API в стиле Kodik | `videocdn.tv` не резолвится (02.11.2026) | — | — | сервис, судя по DNS, мёртв | высокий |
| **Collaps** | озвучки/серии, HLS | iframe `api.delivembd.ws/embed/kp/{kinopoisk_id}` + разбор HTML | без токена (неофиц.) | iframe + HLS | привязка к `kinopoisk_id`, ломается | высокий |
| **Scrapers** (AnimeGo, Animevost, AniLib, AniMedia и др.) | озвучки/серии | неофициальные парсеры | обычно нет | iframe/HLS | антибот, DOM/JS меняются — постоянная поддержка | высокий |

Живое на 02.11.2026: Kodik (отвечает `401` без токена), AniLibria, Anime365,
VK/Rutube/YouTube embed, Sibnet embed, Nyaa. `videocdn.tv` — DNS не резолвится;
Alloha доступна только владельцам сайтов; Collaps — чужой iframe без API.

## Как встроить: архитектура провайдеров

```
src/main/videoSources/
  index.js          # реестр адаптеров + единый контракт
  http.js           # net.fetch с UA/Referer, таймауты
  adapters/
    kodik.js        # уже есть — вынести из main.js
    anilibria.js    # HLS без токена
    manual.js       # своя ссылка (m3u8/mp4/iframe)
    vk.js / rutube.js / youtube.js
    torrent.js      # magnet → локальный HTTP-сервер с Range
```

Контракт адаптера:

```js
// search(ctx) -> [{ sourceItemId, title, year }]
// resolve({ sourceItemId, season, episode }) -> { kind: 'hls'|'mp4'|'iframe', url, headers }
```

IPC в `main.js`: `sources:list`, `sources:search`, `sources:resolve`, плюс
`media:fetch` — прокси для HLS-плейлистов и сегментов (рендерер остаётся
на `connect-src 'self'`, CORS и Referer решает main).

Рендерер: один универсальный плеер вместо Kodik-специфичного.

```js
// kind === 'iframe' → iframe
// kind === 'hls'    → <video> + hls.js с кастомным IpcLoader (грузит через media:fetch)
// kind === 'mp4'    → <video src>
```

`hls.js` кладём в `src/renderer/vendor/` локально (CSP `script-src 'self'`),
CSP расширяем точечно: новые iframe-хосты в `frame-src`, `blob:` и
`http://127.0.0.1:*` в `media-src`.

Маппинг Shikimori → источник (для AniLibria/Anime365) делаем один раз и кешируем
в `tsuzuki-data.json` (например, `prefs.sourceMap`), иначе каждый вход — поиск
по названию.

Торренты (опционально): `webtorrent` в main → `client.add(magnet)` → выбрать
файл серии → `http.createServer` на `127.0.0.1` с поддержкой `Range` →
`<video src="http://127.0.0.1:PORT/ep/3">`. Включать в настройках с
предупреждением о правовых рисках.

## Приоритеты

**P0 (2–3 дня):**
1. Адаптер **AniLibria (HLS)** — максимум пользы без токенов, прямой HLS,
   автопереход серий и «продолжить с места» как в локальном плеере.
2. Инфраструктура HLS: `hls.js` + `IpcLoader` + `media:fetch` + CSP.
3. Адаптер **«Своя ссылка»** — m3u8/mp4/iframe: сразу даёт VK/Rutube/Sibnet/любой CDN.

**P1:**
4. **VK / Rutube / YouTube embed** + oEmbed-метаданные.
5. **Торренты AniLibria + WebTorrent** как отдельный «мощный» режим.

**P2 (не спешить):** Alloha (нужен партнёрский доступ), Collaps/VideoCDN
(нет официального API, ломаются), Anime365 (нужен токен пользователя).

## Метаданные и расписания

- **Shikimori** (уже есть): GraphQL + `/api/calendar`; `shikimori.one` не резолвится — использовать `shikimori.io`.
- **AniList** GraphQL (`graphql.anilist.co`) — fallback для расписания.
- **Jikan v4** (`api.jikan.moe/v4`) — MAL-расписание, лимит 3 rps.
- **AniLibria** schedule — когда серия вышла в озвучке.

## Ссылки (проверено 02.11.2026)

- Kodik: неофиц. док — https://github.com/yanesytortik/animeparsers/blob/cac4c83e03e43f2829506ef202a1279a4e0b78bf/KODIK_API.md ; живой ответ `401` — https://kodik-api.com/
- Kodik-Download-Watch (Flask-приложение, публичные токены + прямые ссылки) — https://github.com/YaNesyTortiK/Kodik-Download-Watch
- AnimeParsers (библиотека: Kodik/AniLibria/Shikimori, `kdk_tokns/tokens.json`) — https://github.com/YaNesyTortiK/AnimeParsers
- AniLibria Swagger — https://anilibria.top/api/docs/v1 ; старые доки v3 — https://github.com/anilibria/docs/blob/master/api_v3.md
- Anime365 — https://anime-365.ru/api-docs ; клиент/описание — https://www.npmjs.com/package/anime365wrapper
- Alloha (условия доступа) — https://alloha.tv/access
- VK Video embed — https://dev.vk.com/ru/widgets/video
- Rutube embed — https://rutube.ru/info/embed/
- YouTube IFrame API — https://developers.google.com/youtube/iframe_api_reference
- WebTorrent — https://github.com/webtorrent/webtorrent
- Shikimori API — https://shikimori.io/api/doc
- AniList GraphQL — https://graphql.anilist.co
- Jikan v4 — https://docs.api.jikan.moe/
- Каталог живых провайдеров — https://github.com/lampac-nextgen/lampac/tree/main/Modules/OnlineAnime

## Правовая оговорка

Kodik, AniLibria, Anime365 и большинство «онлайн-балансеров» раздают контент
без прав правообладателей. Использование таких источников — на усмотрение
пользователя; в приложении они уже опциональны (нужен токен/включение в
настройках). Легальные варианты — официальные сервисы из раздела «Сервисы»
и легальные видео на VK/Rutube/YouTube.
