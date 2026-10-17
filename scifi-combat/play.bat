@echo off
rem Emberfall: play on this PC. Starts a small web server for this folder (PowerShell, nothing to
rem install) and opens the start menu in your browser. Close this window to stop the server.
title Emberfall
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" %*
if errorlevel 1 pause
