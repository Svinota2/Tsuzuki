#!/usr/bin/env node
// ============================================================
//  tools/make-release.mjs — сборка папки release/ для GitHub Releases.
//  ИЗМЕНЕНО В 1.6 (новый файл): готовит файлы и version.json для автообновления.
//
//  Запуск из папки tsuzuki-src:
//    node tools/make-release.mjs
//    node tools/make-release.mjs --repo "mynick/tsuzuki-releases"
//    node tools/make-release.mjs --setup путь\Tsuzuki-Setup-1.6.0.exe --tv путь\Tsuzuki-TV-1.6.0.apk --phone путь\Tsuzuki-Phone-1.6.0.apk
//    node tools/make-release.mjs --notes "Что нового: …"
//
//  Что делает:
//   1) версию берёт из package.json, versionCode/versionName — из обоих app/build.gradle;
//   2) находит собранные файлы (аргументы или поиск рядом с проектом);
//   3) копирует их в release/ под постоянными именами:
//        Tsuzuki-Setup.exe, Tsuzuki-TV.apk, Tsuzuki-Phone.apk
//      (имена без версии нужны для ссылок «releases/latest/download/...»);
//   4) считает SHA-256 каждого файла;
//   5) пишет release/version.json, version-tv.json, version-phone.json
//      (version — для ПК, versionCode/versionName — для Android);
//   6) сам обновляет APPVERSION/VIProductVersion в tools/build-installer.nsi,
//      если они отстают от package.json;
//   7) печатает, какие 6 файлов загрузить в GitHub Release.
//
//  Зависимостей нет — только node:fs, node:crypto, node:path.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const cwd = process.cwd();
const args = process.argv.slice(2);
function arg(name, def = '') {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const hasFlag = (name) => args.includes('--' + name);

// ---------- 1. Версии ----------
const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!version) fail('в package.json нет поля version');

function readGradle(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const code = text.match(/versionCode\s+(\d+)/);
  const name = text.match(/versionName\s+['"]([^'"]+)['"]/);
  return { versionCode: code ? Number(code[1]) : 0, versionName: name ? name[1] : version };
}
const tvGradle = readGradle(path.join(cwd, '..', 'tsuzuki-tv-src', 'app', 'build.gradle'));
const phoneGradle = readGradle(path.join(cwd, '..', 'tsuzuki-phone-src', 'app', 'build.gradle'));
if (!tvGradle) fail('не найден ../tsuzuki-tv-src/app/build.gradle — запусти из папки tsuzuki-src');
if (!phoneGradle) fail('не найден ../tsuzuki-phone-src/app/build.gradle');

// ---------- 2. Поиск собранных файлов ----------
function findFile(explicit, patterns) {
  if (explicit) {
    if (!fs.existsSync(explicit)) fail('не нахожу файл: ' + explicit);
    return path.resolve(explicit);
  }
  const roots = [cwd, path.join(cwd, '..'), path.join(cwd, '..', 'out'), path.join(cwd, '..', 'dist'), path.join(cwd, 'dist')];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (patterns.some((re) => re.test(name))) found.push(path.join(root, name));
    }
  }
  if (!found.length) return null;
  // выбираем самый свежий
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0];
}

const setup = findFile(arg('setup'), [new RegExp('^Tsuzuki-Setup-' + version.replace(/\./g, '\\.') + '\\.exe$'), /^Tsuzuki-Setup.*\.exe$/]);
const tvApk = findFile(arg('tv'), [/^Tsuzuki-TV.*\.apk$/i, /^.*TV.*\.apk$/i]);
const phoneApk = findFile(arg('phone'), [/^Tsuzuki-Phone.*\.apk$/i, /^.*Phone.*\.apk$/i]);

const missing = [];
if (!setup) missing.push('установщик Tsuzuki-Setup-' + version + '.exe (собери через electron-builder + makensis)');
if (!tvApk) missing.push('APK Android TV');
if (!phoneApk) missing.push('APK телефона');
if (missing.length) {
  console.error('Не хватает файлов:\n  - ' + missing.join('\n  - '));
  console.error('Подскажи пути через --setup, --tv, --phone. Скрипт всё равно напишет version.json без ссылок.');
}

// ---------- 3. Репозиторий и адреса ----------
const repo = arg('repo', process.env.GITHUB_REPO || 'НИК/tsuzuki-releases');
const base = 'https://github.com/' + repo + '/releases/latest/download/';
const page = 'https://github.com/' + repo + '/releases/latest';
if (/НИК/i.test(repo)) {
  console.warn('\n⚠ В адресах остался НИК. Запусти с --repo "твой_ник/tsuzuki-releases",');
  console.warn('  иначе вставь адреса вручную в release/*.json и в исходники (settings.js / android-api.js).\n');
}

// ---------- 4. Заметки о версии ----------
let notes = arg('notes', '');
if (!notes) {
  const notesFile = path.join(cwd, 'release-notes.txt');
  if (fs.existsSync(notesFile)) notes = fs.readFileSync(notesFile, 'utf8').trim();
}
if (!notes) notes = 'Версия ' + version;

// ---------- 5. Папка release/ ----------
const out = path.join(cwd, 'release');
fs.mkdirSync(out, { recursive: true });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const files = [];
function prepare(src, name) {
  if (!src) return null;
  const dst = path.join(out, name);
  fs.copyFileSync(src, dst);
  const hash = sha256(dst);
  files.push({ name, size: fs.statSync(dst).size, sha256: hash });
  return hash;
}
const setupHash = prepare(setup, 'Tsuzuki-Setup.exe');
const tvHash = prepare(tvApk, 'Tsuzuki-TV.apk');
const phoneHash = prepare(phoneApk, 'Tsuzuki-Phone.apk');

const json = (file, obj) => fs.writeFileSync(path.join(out, file), JSON.stringify(obj, null, 2) + '\n', 'utf8');

json('version.json', {
  version,
  url: base + 'Tsuzuki-Setup.exe',
  sha256: setupHash || '',
  page,
  notes,
});
json('version-tv.json', {
  version,
  versionCode: tvGradle.versionCode,
  versionName: tvGradle.versionName,
  apk: base + 'Tsuzuki-TV.apk',
  sha256: tvHash || '',
  page,
  notes,
});
json('version-phone.json', {
  version,
  versionCode: phoneGradle.versionCode,
  versionName: phoneGradle.versionName,
  apk: base + 'Tsuzuki-Phone.apk',
  sha256: phoneHash || '',
  page,
  notes,
});

// ---------- 6. NSIS: APPVERSION/VIProductVersion из package.json ----------
const nsiPath = path.join(cwd, 'tools', 'build-installer.nsi');
let nsiNote = '';
if (fs.existsSync(nsiPath)) {
  const raw = fs.readFileSync(nsiPath, 'utf8');
  const next = raw
    .replace(/(!define\s+APPVERSION\s+")[^"]*(")/, '$1' + version + '$2')
    .replace(/(VIProductVersion\s+")[^"]*(")/, '$1' + version + '.0$2');
  if (next !== raw) {
    fs.writeFileSync(nsiPath, '\uFEFF' + next.replace(/^\uFEFF/, ''), 'utf8');
    nsiNote = 'обновил APPVERSION/VIProductVersion в tools/build-installer.nsi на ' + version;
  } else {
    nsiNote = 'APPVERSION в tools/build-installer.nsi уже ' + version;
  }
} else {
  nsiNote = 'tools/build-installer.nsi не найден — проверь APPVERSION вручную';
}

// ---------- 7. Итог ----------
console.log('\nВерсия: ' + version + '  (ТВ versionCode ' + tvGradle.versionCode + ', телефон ' + phoneGradle.versionCode + ')');
console.log('Папка:  ' + out);
for (const f of files) {
  console.log('  ' + f.name.padEnd(20) + ' ' + (f.size / 1048576).toFixed(2) + ' МБ  sha256 ' + f.sha256.slice(0, 16) + '…');
}
console.log('  version.json / version-tv.json / version-phone.json — готовы');
console.log('\n' + nsiNote);
console.log('\nЧто загрузить в GitHub Release (тег v' + version + '):');
for (const name of files.map((f) => f.name).concat(['version.json', 'version-tv.json', 'version-phone.json'])) {
  console.log('  release/' + name);
}
console.log('\nСсылки вида releases/latest/download/<имя> начнут работать сразу после публикации релиза.');

function fail(msg) {
  console.error('Ошибка: ' + msg);
  process.exit(1);
}
