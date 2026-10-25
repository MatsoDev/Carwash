@echo off
chcp 65001 >nul
title تحديث مغسلة سيارات
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\update.ps1"
echo.
pause
