@echo off
setlocal enableextensions

rem Optional: pass collection URL as first arg; or use TFVC_COLLECTION env var; defaults to surreal.visualstudio.com
set "COLLECTION=%~1"
if not defined COLLECTION if defined TFVC_COLLECTION set "COLLECTION=%TFVC_COLLECTION%"
if not defined COLLECTION set "COLLECTION=https://surreal.visualstudio.com"

rem Sanitize collection URL to base collection (dev.azure.com/<org> or <org>.visualstudio.com)
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "$ErrorActionPreference='SilentlyContinue'; try { $u=[uri]'%COLLECTION%'; if($u.Host -eq 'dev.azure.com'){ $org=$u.AbsolutePath.Trim('/').Split('/')[0]; if([string]::IsNullOrEmpty($org)){ 'https://dev.azure.com' } else { 'https://dev.azure.com/'+$org } } elseif($u.Host -like '*.visualstudio.com'){ $u.Scheme+'://'+$u.Host } else { ($u.Scheme+'://'+$u.Host) } } catch { '%COLLECTION%' }"`) do set "COLLECTION=%%S"

rem Allow explicit override via TFVC_EXE env var
set "TF_EXE=%TFVC_EXE%"

if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"
if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"
if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"
if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"
if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"
if not exist "%TF_EXE%" set "TF_EXE=C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe"

if not exist "%TF_EXE%" (
  echo [ERROR] TF.exe not found. Set TFVC_EXE env var to the full path to TF.exe.
  exit /b 1
)

echo Using TF.exe: "%TF_EXE%"
echo Triggering TFVC sign-in for collection: %COLLECTION%

rem Launch with a visible window to ensure the sign-in UI can appear
start "TFVC Sign-In" "%TF_EXE%" workspaces /collection:%COLLECTION%
waitfor /t 2 /si TFVC_SIGNIN_DUMMY >nul 2>&1
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo TF.exe returned exit code %ERR%.
  echo If no sign-in window appeared, clear credentials in Windows Credential Manager and retry.
)

exit /b %ERR%


