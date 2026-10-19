@echo off
rem Make the NotebookLM token file for Team HQ. Double-click this in the folder you unzipped.
cd /d "%~dp0"
title Team HQ: make the NotebookLM token

where python >nul 2>nul
if %errorlevel%==0 (
  python make_notebook_token.py
) else (
  py -3 make_notebook_token.py
)
set RESULT=%errorlevel%

echo.
if %RESULT%==0 (
  echo Finished.
) else (
  echo Did not finish. Read the message above, then double-click this file again.
)
echo.
pause
exit /b %RESULT%
