@echo off
rem Klassicheskaya era 1.0 - local site on http://localhost:8000
rem Uses built-in Windows PowerShell, nothing to install.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 pause
