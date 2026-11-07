@echo off
chcp 65001 >nul
rem Tsuzuki 1.6.1: creates a new APK signing key (see make-keystore.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-keystore.ps1"
echo.
pause
