@echo off
setlocal

set "GRADLE_USER_HOME=C:\GradleCache\Together"
if not exist "%GRADLE_USER_HOME%" mkdir "%GRADLE_USER_HOME%"

set "PROJECT_DIR=f:\Together\Together\frontend\android"
set "STUDIO_BIN=C:\Program Files\Android\Android Studio\bin\studio64.exe"

start "" "%STUDIO_BIN%" "%PROJECT_DIR%"
