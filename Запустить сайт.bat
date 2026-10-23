@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Классическая эра 1.0 — локальный сайт
echo   Адрес: http://localhost:8000
echo   Не закрывайте это окно, пока смотрите сайт.
echo.
start "" http://localhost:8000
where python >nul 2>nul && (python -m http.server 8000 & goto :eof)
where py >nul 2>nul && (py -m http.server 8000 & goto :eof)
where npx >nul 2>nul && (npx --yes serve -l 8000 . & goto :eof)
echo   Не найден ни Python, ни Node.js. Установите Python с python.org и запустите снова.
pause
