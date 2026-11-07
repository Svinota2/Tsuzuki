# Tsuzuki 1.4.0 для телефона (Android)

Тот же Tsuzuki, что и на ПК, но с интерфейсом под узкий экран: меню сведено в
горизонтальную полосу сверху, карточки в 2–3 колонки, страница тайтла и плеер —
в одну колонку. Работает в портрете и альбомной ориентации, на телефоне и планшете.
Онлайн-просмотр Kodik, токены, импорт, статистика, «Продолжить просмотр» —
как в остальных версиях.

Готовый файл — `Tsuzuki-Phone-1.4.0.apk`. Установка: разрешить установку из
неизвестных источников и открыть APK (флешка, Send Files to TV, adb install).

## Чем отличается от TV-проекта

| | TV (`tsuzuki-tv-src`) | Телефон (`tsuzuki-phone-src`) |
|---|---|---|
| applicationId | `local.tsuzuki.tv` | `local.tsuzuki.phone` |
| Ориентация | всегда альбомная (`landscape`) | как повернёшь (`fullSensor`) |
| viewport | `width=1280` (масштаб под ТВ) | `width=device-width` |
| Стили | `tv.css` (рамка фокуса) | `tv.css` + `phone.css` (раскладка под узкий экран) |
| Пульт | да (tv-nav.js) | работает, но не обязателен |

Интерфейс общий: правишь `anidesk/src/renderer` (ПК-версия) → `sync-www.sh` →
собираешь APK. Телефонная раскладка — только в `app/src/main/assets/www/phone.css`,
на ТВ и ПК она не подключается.

## Как пересобрать

1. Убедись, что `local.properties` указывает на Android SDK (`sdk.dir=...`).
2. `./gradlew assembleRelease` (на Windows `gradlew.bat assembleRelease`).
3. APK: `app/build/outputs/apk/release/app-release.apk`.

Нужны JDK 17+ и Android SDK (compileSdk 35). Перед новой сборкой увеличь
`versionCode` в `app/build.gradle`.

## Значок и баннер

Иконки и баннер — в `app/src/main/res/` (mipmap/drawable), те же, что в TV-проекте.

## Что нового в 1.5.0

- Java-файлы (`app/src/main/java/...`) теперь **такие же, как в TV-проекте**: уведомления о новых
  сериях, обновление из приложения, вход в Shikimori, статистика — всё, что раньше было только на ТВ.
- `sync-www.sh` исправлен: берёт `android-api.js`/`tv-nav.js`/`tv.css` из `../tsuzuki-tv-src/tv-web`,
  ставит ширину страницы под экран телефона и подключает `phone-web/phone.css`
  (раньше после пересборки телефон получал ТВ-раскладку).
- Порядок сборки: `./sync-www.sh ../tsuzuki-src ../tsuzuki-tv-src` → `./gradlew assembleRelease`.
