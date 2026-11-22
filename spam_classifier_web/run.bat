@echo off
cd /d %~dp0
echo === SpamGuard AI - setup and launch ===
if not exist .venv (
  echo Creating Python virtual environment...
  py -m venv .venv
)
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 (
 echo Installation failed. Check your internet connection and Python installation.
 pause
 exit /b 1
)
echo.
echo Opening local app in browser at http://127.0.0.1:5000
python app.py
pause
