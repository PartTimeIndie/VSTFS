@echo off
echo Testing TF.exe commands...
echo.

echo 1. Testing workspace list:
"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe" workspaces /collection:https://surreal.visualstudio.com
echo.

echo 2. Testing current workspace:
"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe" workspace
echo.

echo 3. Testing status (should work if workspace is configured):
"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe" status
echo.

pause
