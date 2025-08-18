@echo off
echo Building VSTFS Extension...

echo Installing dependencies...
call npm install

echo Compiling TypeScript...
call npm run compile

echo Packaging extension...
call npm run package

echo Build complete!
pause
