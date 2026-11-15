@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 使いすぎ番：見本を見る
echo.
echo  使いすぎ番：にせの AI の会社と架空の社員 3 人で、上限・伏せ字・記録の動きを見せます。
echo  （本物の AI は呼びません。API キーは要りません。外へは何も送りません）
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode

echo  3 秒ほどで、ブラウザに見本の管理画面が開きます。鍵の欄には、下に出る「管理画面の鍵（見本用）」を入れてください。
echo  見終わったら、この窓を閉じてください。
echo.
if not defined TSUKAISUGI_NO_OPEN start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8788/admin'"
node bin\demo.mjs
if errorlevel 1 goto fail
goto end

:nonode
echo  Node.js が入っていません。
echo  1. https://nodejs.org/ja を開き、「LTS」と書かれた方を入れてください（無料）。
echo  2. 入れ終わったら、もう一度このファイルをダブルクリックしてください。
goto end

:fail
echo.
echo  途中で止まりました。上に出た文をそのまま写して、garageten.info@gmail.com へお知らせください。

:end
echo.
if not defined TSUKAISUGI_NO_PAUSE pause
endlocal
