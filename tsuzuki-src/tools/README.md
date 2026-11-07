# Инструменты сборки и проверки

## Windows

1. **Сборка app.asar из исходников** (нужен Node.js):
   ```powershell
   npx --yes @electron/asar pack <папка-исходников> app.asar
   Copy-Item app.asar <портативная-папка>\resources\app.asar -Force
   ```
2. **Установщик** — `build-installer.nsi` (NSIS 3).
   - NSIS можно взять из `electron-builder-binaries` (`nsis-3.0.4.1.7z`) или поставить
     `winget install -e --id NSIS.NSIS`.
   - ⚠️ Файл .nsi должен быть сохранён в **UTF-8 с BOM**, иначе русский текст в
     окнах установщика станет «кракозябрами». Если редактировал в блокноте — проверь:
     ```powershell
     $b = [System.IO.File]::ReadAllBytes('build-installer.nsi'); $b[0..2] -join ','
     # должно быть 239,187,191 (BOM)
     ```
   - Сборка: `makensis build-installer.nsi` (поправь в скрипте `APPDIR` и `OUTFILE`).
   - Проверка тихой установки: `Tsuzuki-Setup-1.2.0.exe /S /D=C:\TsuzukiTest`.
3. **Портативный zip**:
   ```powershell
   Compress-Archive -Path <портативная-папка>\* -DestinationPath Tsuzuki-win-x64-kodik.zip -Force
   ```

## Проверка через CDP (без ручных кликов)

Запуск приложения с отладочным портом:
```powershell
Start-Process .\Tsuzuki-kodik\Tsuzuki.exe -ArgumentList '--remote-debugging-port=9350'
```

Скрипты в `test-cdp/` (нужен Node.js):
- `v11-smoke.mjs` — каталог, склейка сезонов, страница тайтла (сезоны + статистика),
  настройки/кастомизация, «Продолжить просмотр», 18+, история, Kodik-плеер,
  отдельное окно плеера, adblock.
- `v12-features.mjs` — темы, импорт MAL (парсер + запись), клик по серии,
  кнопки «Смотреть онлайн».

В каждом скрипте сверху поправь `PORT` (должен совпадать с портом запуска) и
`OUT` (папка для скриншотов). Перед прогоном сохрани копию
`%APPDATA%\Tsuzuki\tsuzuki-data.json` и восстанови после — тесты меняют данные.

Ожидаемый результат: в конце печатается JSON, в нём `errors: []`,
`watch.tr > 0`, `playerWindow.opened: true`, `adblock.blocked > 0`.

## Linux

См. `../HANDOFF.md`, раздел «Linux-версия»: electron-builder конфиг уже в
`package.json` (`npm run dist:linux`), иконка — `../build/icon.png`.
