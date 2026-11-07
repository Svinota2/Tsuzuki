; ============================================================
;  Установщик Tsuzuki для Windows (NSIS 3) — в тёмной теме приложения.
;  ВАЖНО: файл в UTF-8 С BOM, иначе русский текст = «кракозябры».
;
;  Поведение:
;   - чистая установка: мастер с тёмным оформлением;
;   - если Tsuzuki уже установлен (реестр/папка) — обновление «на месте»:
;     без выбора папки, запущенное приложение закрывается;
;   - если установлен старый AniDesk — тоже обновление: ставим Tsuzuki
;     и аккуратно убираем старую установку (ярлыки, реестр, папку).
;     Данные (%APPDATA%\AniDesk) не трогаем — Tsuzuki перенесёт их сам.
; ============================================================

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SetDatablockOptimize on

!include "LogicLib.nsh"
!include "MUI2.nsh"

!define APPNAME "Tsuzuki"
!define APPOLD "AniDesk"
!define APPVERSION "1.6.4"
!define APPDIR "${__FILEDIR__}\..\dist\win-unpacked"
!define OUTFILE "${__FILEDIR__}\..\dist\Tsuzuki-Setup-${APPVERSION}.exe"
!define ASSETS "${__FILEDIR__}\..\build\installer"

; ---------- Тема приложения ----------
!define MUI_BGCOLOR "0F1115"
!define MUI_TEXTCOLOR "E9ECF2"
!define MUI_ICON "${ASSETS}\tsuzuki.ico"
!define MUI_UNICON "${ASSETS}\tsuzuki.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ASSETS}\header.bmp"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ASSETS}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ASSETS}\welcome-uninstall.bmp"

Name "${APPNAME} ${APPVERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
BrandingText "Tsuzuki — каталог, трекер и онлайн-просмотр аниме"

VIProductVersion "1.6.4.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${APPVERSION}.0"
VIAddVersionKey "ProductVersion" "${APPVERSION}"
VIAddVersionKey "LegalCopyright" "Tsuzuki"

Var IsUpdate
Var OldDir

; ---------- Определяем, ставим впервые или обновляем ----------
Function .onInit
  StrCpy $IsUpdate "0"
  StrCpy $OldDir ""

  ; Если папку задали вручную через /D — не переопределяем
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\${APPNAME}" 0 noDefaultDir

  ; 1) Уже установлен Tsuzuki?
  ReadRegStr $0 HKCU "Software\${APPNAME}" "InstallDir"
  ${If} $0 != ""
    ; ИСПРАВЛЕНО В 1.5.0: если в реестре остался путь от удалённой/тестовой установки,
    ; не ставим туда — возвращаемся к обычной папке в профиле пользователя.
    IfFileExists "$0\${APPNAME}.exe" 0 resetStaleDir
    StrCpy $INSTDIR $0
    StrCpy $IsUpdate "1"
    Goto dirReady
    resetStaleDir:
    StrCpy $0 ""
  ${EndIf}
  ${If} $0 == ""
    IfFileExists "$LOCALAPPDATA\Programs\${APPNAME}\${APPNAME}.exe" 0 checkOldApp
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APPNAME}"
    StrCpy $IsUpdate "1"
  ${EndIf}
  dirReady:

  checkOldApp:
  ; 2) Остался старый AniDesk? Ставим Tsuzuki и убираем старую установку
  ReadRegStr $0 HKCU "Software\${APPOLD}" "InstallDir"
  ${If} $0 == ""
    StrCpy $0 "$LOCALAPPDATA\Programs\${APPOLD}"
  ${EndIf}
  IfFileExists "$0\${APPOLD}.exe" 0 noDefaultDir
  StrCpy $OldDir $0
  StrCpy $IsUpdate "1"

  noDefaultDir:
FunctionEnd

Function WelcomePre
  ${If} $IsUpdate == "1"
    Abort
  ${EndIf}
FunctionEnd

Function DirPre
  ${If} $IsUpdate == "1"
    Abort
  ${EndIf}
FunctionEnd

; ---------- Закрываем запущенные версии перед обновлением ----------
Function CheckRunning
  FindWindow $0 "" "${APPNAME}"
  ${If} $0 != 0
    IfSilent killTsuzuki
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "${APPNAME} сейчас запущен. Закрыть его и продолжить установку?" IDOK killTsuzuki
    Abort
    killTsuzuki:
    nsExec::Exec 'taskkill /IM ${APPNAME}.exe /F'
    Sleep 1200
  ${EndIf}

  FindWindow $0 "" "${APPOLD}"
  ${If} $0 != 0
    IfSilent killOld
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "Старый AniDesk сейчас запущен. Закрыть его и обновить до Tsuzuki?" IDOK killOld
    Abort
    killOld:
    nsExec::Exec 'taskkill /IM ${APPOLD}.exe /F'
    Sleep 1200
  ${EndIf}
FunctionEnd

; ---------- Убираем старую установку AniDesk после копирования файлов ----------
Function RemoveOldAniDesk
  ${If} $OldDir == ""
    Return
  ${EndIf}
  nsExec::Exec 'taskkill /IM ${APPOLD}.exe /F'
  Sleep 800
  Delete "$DESKTOP\${APPOLD}.lnk"
  Delete "$SMPROGRAMS\${APPOLD}\${APPOLD}.lnk"
  Delete "$SMPROGRAMS\${APPOLD}\Удалить ${APPOLD}.lnk"
  RMDir "$SMPROGRAMS\${APPOLD}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPOLD}"
  DeleteRegKey HKCU "Software\${APPOLD}"
  ; удаляем только папку самой программы (данные лежат в %APPDATA% и не трогаются)
  RMDir /r "$OldDir"
FunctionEnd

!define MUI_ABORTWARNING
; ИЗМЕНЕНО В 1.6: после тихой установки (автообновление) запускаем Tsuzuki заново,
; чтобы пользователь сразу вернулся в приложение уже новой версии.
Function .onInstSuccess
  ${If} ${Silent}
    Exec '"$INSTDIR\${APPNAME}.exe"'
  ${EndIf}
FunctionEnd
!define MUI_WELCOMEPAGE_TITLE "Установка Tsuzuki"
!define MUI_WELCOMEPAGE_TEXT "Tsuzuki — каталог и трекер аниме с онлайн-просмотром.$\r$\n$\r$\nМастер установит приложение в профиль пользователя, создаст ярлыки на рабочем столе и в меню «Пуск». Права администратора не нужны.$\r$\n$\r$\nЕсли Tsuzuki уже установлен, мастер просто обновит его и сохранит все данные."
!define MUI_FINISHPAGE_TITLE "Tsuzuki установлен"
!define MUI_FINISHPAGE_TEXT "Приложение готово к работе.$\r$\n$\r$\nПри первом запуске Tsuzuki сам перенесёт список и настройки из старой версии (AniDesk), если она была установлена. Данные хранятся в %APPDATA%\Tsuzuki."
; Убрали галочку «Запустить Tsuzuki» с финального экрана —
; её подпись в части сборок NSIS выводилась «квадратиками». Запуск — из ярлыка.
!define MUI_PAGE_CUSTOMFUNCTION_PRE WelcomePre
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE DirPre
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

Section "${APPNAME} (обязательно)" SecMain
  SectionIn RO
  Call CheckRunning
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Удалить ${APPNAME}.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "Tsuzuki"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\${APPNAME}.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1

  Call RemoveOldAniDesk
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Удалить ${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKCU "Software\${APPNAME}"
  RMDir /r "$INSTDIR"
SectionEnd
