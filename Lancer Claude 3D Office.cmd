@echo off
rem Double-click to open the office. Keep this window open while you use it.
cd /d "%~dp0"
node bin\cli.js start
pause
