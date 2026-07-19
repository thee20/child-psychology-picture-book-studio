@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Shared/browser start: do NOT set STUDIO_OWNED_BY=desktop (desktop shell must own that flag).
rem Redirect logs to TEMP so project dir does not accumulate proxy URLs.
start "儿童心理绘本工坊服务" /min cmd /c "node server.js > \"%TEMP%\child-psychology-picture-book-studio.log\" 2>&1"
timeout /t 2 /nobreak >nul
if exist "PictureBookStudio-Launcher.exe" (
  start "" "PictureBookStudio-Launcher.exe"
) else (
  start "" "http://127.0.0.1:4173"
)

