@echo off
set HTML_FILE=%~dp0index.html
set CHROME_ARGS=--disable-web-security --user-data-dir="%LOCALAPPDATA%\快连ai-browser"

:: Detect default browser (Edge/Chrome/Brave are Chromium-based)
for /f "skip=2 tokens=3" %%A in ('reg query "HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" /v ProgId 2^>nul') do set PROG_ID=%%A

:: Edge
if /i "%PROG_ID%"=="MSEdgeHTM" goto :edge
:: Chrome
if /i "%PROG_ID%"=="ChromeHTML" goto :chrome
:: Brave
if /i "%PROG_ID%"=="BraveHTML" goto :brave
:: Not Chromium, find one
goto :fallback

:edge
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
goto :fallback

:chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
goto :fallback

:brave
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
goto :fallback

:fallback
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" %CHROME_ARGS% "%HTML_FILE%"
    exit /b
)

:: No Chromium found
echo No Chrome/Edge/Brave found. Using default browser (some APIs may fail).
start "" "%HTML_FILE%"