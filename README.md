# Tsuzuki 続き

Трекер аниме для **Windows, Linux, Android TV и Android-телефона**.

Каталог с поиском, трекер серий и оценок, вход через Shikimori, встроенный плеер с автоотметкой просмотренного, статистика и итоги года, уведомления о новых сериях.

Новости проекта: [t.me/TsuzukiAnime](https://t.me/TsuzukiAnime)

## Структура

| Папка | Что внутри |
|---|---|
| `tsuzuki-src/` | Версия для ПК (Electron): Windows и Linux. Отсюда же берётся интерфейс для Android |
| `tsuzuki-tv-src/` | Android TV (WebView + Java-мост `NativeBridge`) |
| `tsuzuki-phone-src/` | Android-телефон (тот же интерфейс, своя раскладка `phone-web/phone.css`) |
| `docs/` | История разработки, политика конфиденциальности, инструкции по сборке |

Подробности по сборке: `tsuzuki-src/README.md`, `tsuzuki-tv-src/README.md`, `tsuzuki-phone-src/README.md`.
Список изменений по версиям: `tsuzuki-src/CHANGES-*.md`.

## Сборка коротко

**ПК:** `cd tsuzuki-src && npm install && npm start` (запуск), установщик — по `tools/README.md`.

**Android TV:** `cd tsuzuki-tv-src && ./sync-www.sh && ./gradlew assembleRelease`

**Телефон:** `cd tsuzuki-phone-src && ./sync-www.sh ../tsuzuki-src ../tsuzuki-tv-src && ./gradlew assembleRelease`

`sync-www.sh` на Windows запускай в Git Bash.

## Ключ подписи

`tsuzuki.keystore` **не хранится в репозитории**. Положи его в `tsuzuki-tv-src/app/` и `tsuzuki-phone-src/app/` перед сборкой Android.
Без того же самого ключа обновление не встанет поверх установленной версии.

## Готовые сборки

Установщики и APK — в разделе **Releases**.
