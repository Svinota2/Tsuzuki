#!/usr/bin/env bash
# ============================================================
#  Копирует интерфейс из ПК-версии в Android-проект.
#  Запуск:  ./sync-www.sh /путь/к/tsuzuki   (по умолчанию ../tsuzuki)
#  Интерфейс у обеих версий общий: правишь src/renderer на ПК —
#  запускаешь этот скрипт — собираешь APK.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"
SRC="${1:-../tsuzuki-src}/src/renderer"
DST="app/src/main/assets/www"
[ -f "$SRC/index.html" ] || { echo "Не найден $SRC/index.html"; exit 1; }

rm -rf "$DST"
mkdir -p "$DST"
cp -r "$SRC"/. "$DST"/
rm -f "$DST/views/player.js.bak"
cp tv-web/android-api.js tv-web/tv-nav.js tv-web/tv.css "$DST"/

# index.html: ширина страницы под ТВ, мост к Android, навигация пультом
python3 - "$DST/index.html" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <meta name="viewport" content="width=1280" />', 1)
s = s.replace('<link rel="stylesheet" href="styles/app.css" />', '<link rel="stylesheet" href="styles/app.css" />\n  <link rel="stylesheet" href="tv.css" />', 1)
s = s.replace('<script type="module" src="app.js"></script>', '<script src="android-api.js"></script>\n  <script type="module" src="app.js"></script>\n  <script src="tv-nav.js" defer></script>', 1)
# сайты не грузим внутрь — Shikimori идёт через Java-мост
open(p, 'w', encoding='utf-8').write(s)
PY
echo "Готово: $DST"
