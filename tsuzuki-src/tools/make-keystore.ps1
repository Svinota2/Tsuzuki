# ============================================================
#  ДОБАВЛЕНО В 1.6.1: новый ключ подписи APK для Tsuzuki (ТВ и телефон).
#
#  Запуск: двойной щелчок по make-keystore.bat (лежит рядом).
#
#  Что делает:
#   1) находит keytool (из Android Studio или Java);
#   2) спрашивает папку для ключа (по умолчанию Документы\Tsuzuki-key)
#      и пароль — пароль вводишь ты, он нигде не показывается;
#   3) создаёт ключ tsuzuki-release.jks (RSA 4096, срок 100 лет);
#   4) записывает keystore.properties в tsuzuki-tv-src и tsuzuki-phone-src —
#      оттуда его берёт gradlew assembleRelease.
#
#  Ключ НИКОГДА не выкладывай в интернет и не клади в папку с исходниками.
#  Сделай 2 копии (флешка + облако) и запиши пароль. Потеряешь ключ —
#  обновления APK у пользователей перестанут ставиться поверх.
#
#  Существующий ключ скрипт не перезаписывает никогда.
#  Чтобы подписывать СТАРЫМ ключом, напиши keystore.properties вручную
#  (формат — в комментарии app/build.gradle).
# ============================================================
param(
  [string]$KeyDir = ''   # папка для ключа; пусто — спросить
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

# ---------- Где проекты ----------
$root = (Resolve-Path (Join-Path $PSScriptRoot (Join-Path '..' '..'))).Path   # папка «Исходники»
$projects = @('tsuzuki-tv-src', 'tsuzuki-phone-src') |
  ForEach-Object { Join-Path $root $_ } |
  Where-Object { Test-Path $_ }
if (-not $projects) { throw "Не нашёл tsuzuki-tv-src и tsuzuki-phone-src рядом с $root" }

# ---------- keytool ----------
function Find-Keytool {
  $exe = if ($IsLinux -or $IsMacOS) { 'keytool' } else { 'keytool.exe' }
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME (Join-Path 'bin' $exe)) }
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles "Android\Android Studio\jbr\bin\$exe") }
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Android Studio\jbr\bin\$exe") }
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}
$keytool = Find-Keytool
if (-not $keytool) {
  throw 'Не нашёл keytool. Он есть в Android Studio (папка jbr\bin) или в любой Java. Установи Android Studio или укажи JAVA_HOME.'
}

# ---------- Папка и файл ключа ----------
if (-not $KeyDir) {
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if (-not $docs) { $docs = $HOME }
  $defaultDir = Join-Path $docs 'Tsuzuki-key'
  $answer = Read-Host "Папка для ключа (Enter — $defaultDir)"
  $KeyDir = if ([string]::IsNullOrWhiteSpace($answer)) { $defaultDir } else { $answer.Trim('" ') }
}
if ($KeyDir -like "$root*") {
  throw 'Не клади ключ в папку «Исходники» — оттуда он может попасть на GitHub. Выбери другую папку.'
}
New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
$jks = Join-Path (Resolve-Path $KeyDir).Path 'tsuzuki-release.jks'
$alias = 'tsuzuki'
$isNew = -not (Test-Path $jks)

# ---------- Пароль ----------
function Read-Secret($prompt) {
  if ($env:TSUZUKI_KEY_PASSWORD) { return $env:TSUZUKI_KEY_PASSWORD }   # для автоматических сборок
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

if ($isNew) {
  Say ''
  Say 'Придумай пароль для ключа: латиница, цифры и знаки, минимум 8 символов (лучше 12+). Запиши его!' 'Yellow'
  $pw = Read-Secret 'Пароль'
  if ($pw.Length -lt 8) { throw 'Пароль короче 8 символов.' }
  # Русские буквы в пароле ключа разные программы понимают по-разному — только латиница
  if ($pw -notmatch '^[\x21-\x7E]+$') { throw 'В пароле можно только латинские буквы, цифры и знаки (без русских букв и пробелов).' }
  if (-not $env:TSUZUKI_KEY_PASSWORD) {
    $pw2 = Read-Secret 'Повтори пароль'
    if ($pw -ne $pw2) { throw 'Пароли не совпали — запусти ещё раз.' }
  }
  Say "Создаю ключ: $jks" 'Cyan'
  & $keytool -genkeypair -storetype PKCS12 -keystore $jks -alias $alias `
    -keyalg RSA -keysize 4096 -validity 36500 `
    -storepass $pw -keypass $pw -dname 'CN=Tsuzuki, O=Tsuzuki, C=RU' | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jks)) { throw 'keytool не смог создать ключ.' }
} else {
  Say "Ключ уже есть: $jks — его НЕ трогаю." 'Yellow'
  Say 'Введи его пароль, чтобы записать keystore.properties.'
  $pw = Read-Secret 'Пароль ключа'
}

# Проверяем, что пароль подходит, и берём отпечаток сертификата
try { $list = & $keytool -list -v -keystore $jks -alias $alias -storepass $pw 2>&1 } catch { $list = $null }
if ($LASTEXITCODE -ne 0 -or -not $list) { throw 'Пароль не подходит к ключу (или в ключе нет записи tsuzuki).' }
$fingerprint = ($list | Select-String 'SHA256:' | Select-Object -First 1).ToString().Trim()

# ---------- keystore.properties ----------
# Java читает .properties в Latin-1: русские буквы и «\» экранируем как \uXXXX и \\
function Escape-Prop([string]$v) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $v.ToCharArray()) {
    $code = [int]$ch
    if ($ch -eq '\') { [void]$sb.Append('\\') }
    elseif ($code -lt 32 -or $code -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
    else { [void]$sb.Append($ch) }
  }
  return $sb.ToString()
}
$storePath = $jks -replace '\\', '/'
$content = @(
  '# Created by tsuzuki-src/tools/make-keystore.ps1 - DO NOT COMMIT OR PUBLISH',
  "storeFile=$(Escape-Prop $storePath)",
  "storePassword=$(Escape-Prop $pw)",
  "keyAlias=$alias",
  "keyPassword=$(Escape-Prop $pw)"
) -join "`n"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($p in $projects) {
  $file = Join-Path $p 'keystore.properties'
  if (Test-Path $file) { Copy-Item $file "$file.bak-$stamp" }
  [IO.File]::WriteAllText($file, $content + "`n", [Text.Encoding]::ASCII)
  Say "Записал $file" 'Green'
}

Say ''
Say 'Готово!' 'Green'
Say "Ключ:      $jks"
Say "Отпечаток: $fingerprint"
Say ''
Say 'Дальше:' 'Yellow'
Say ' 1) Скопируй tsuzuki-release.jks на флешку и в облако, пароль запиши.'
Say ' 2) Собери APK как обычно: gradlew assembleRelease (в обоих проектах).'
Say ' 3) keystore.properties и .jks в git не попадут (.gitignore), но всё равно проверь перед push.'
