@echo off
rem Open the single-file viewer (the .html in this folder) in the DEFAULT BROWSER.
rem ASCII-only + CRLF on purpose: a UTF-8 / bare-LF .bat breaks cmd.exe parsing.
rem The Chinese file name is picked up from the file system, never typed here.
cd /d "%~dp0"
for %%F in (*.html) do if /i not "%%~nxF"=="index.html" start "" "%%~fF"
exit /b 0
