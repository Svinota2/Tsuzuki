#!/usr/bin/env bash
# ============================================================
#  Копирует интерфейс из ПК-версии в ТЕЛЕФОННЫЙ Android-проект.
#  Запуск:  ./sync-www.sh [папка ПК-версии] [папка TV-проекта]
#           (по умолчанию ../tsuzuki-src и ../tsuzuki-tv-src)
#
#  ИЗМЕНЕНО В 1.5:
#  - android-api.js, tv-nav.js, tv.css берутся из TV-проекта (одна копия
#    на обе версии — раньше телефонная отставала и в ней не было входа
#    в Shikimori, статистики и обновлений);
#  - viewport = ширина экрана телефона (было 1280, как на ТВ);
#  - подключается phone.css из папки phone-web (раньше скрипт его стирал).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"
SRC="${1:-../tsuzuki-src}/src/renderer"
TV="${2:-../tsuzuki-tv-src}/tv-web"
DST="app/src/main/assets/www"
[ -f "$SRC/index.html" ] || { echo "Не найден $SRC/index.html"; exit 1; }
[ -f "$TV/android-api.js" ] || { echo "Не найден $TV/android-api.js (нужен TV-проект рядом)"; exit 1; }

rm -rf "$DST"
mkdir -p "$DST"
cp -r "$SRC"/. "$DST"/
rm -f "$DST/views/player.js.bak"
cp "$TV/android-api.js" "$TV/tv-nav.js" "$TV/tv.css" "$DST"/
cp phone-web/phone.css "$DST"/

python3 - "$DST/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />', 1)
s = s.replace('<link rel="stylesheet" href="styles/app.css" />', '<link rel="stylesheet" href="styles/app.css" />\n  <link rel="stylesheet" href="tv.css" />\n  <link rel="stylesheet" href="phone.css" />', 1)
s = s.replace('<script type="module" src="app.js"></script>', '<script>window.__deviceType = "phone";</script>\n  <script src="android-api.js"></script>\n  <script type="module" src="app.js"></script>\n  <script src="tv-nav.js" defer></script>', 1)
open(p, 'w', encoding='utf-8').write(s)
PY
echo "Готово: $DST"
