@echo off
chcp 65001 >nul
title مغسلة سيارات - الكاشير
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  if errorlevel 1 pause
  exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
  python tools\serve.py
  if errorlevel 1 pause
  exit /b
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 tools\serve.py
  if errorlevel 1 pause
  exit /b
)

echo.
echo ⚠️  مش لاقي Node.js ولا Python على الجهاز.
echo.
echo    عشان التطبيق يشتغل صح وبياناته تتحفظ، محتاج واحد منهم:
echo    1) Node.js  - نزّله من https://nodejs.org  (اختار LTS)
echo    2) Python 3 - نزّله من https://python.org
echo.
echo    بعد التثبيت اقفل النافذة دي وافتح start.bat تاني.
echo    متفتحش index.html مباشرة الا لو مضطر - البيانات ممكن متتحفظش.
echo.
pause
exit /b 1
