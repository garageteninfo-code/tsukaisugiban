@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 使いすぎ番（この窓を閉じると止まります）
echo.
echo  使いすぎ番を起動します。この窓を開いている間だけ動きます。止めるときは、この窓を閉じてください。
echo  会社の API キーは、Windows の「環境変数」に入れておきます（導入手順書.md の 2 章）。このファイルには書きません。
echo.
where node >nul 2>nul
if errorlevel 1 goto nonode

if not defined TSUKAISUGI_NO_OPEN start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8787/admin'"
node bin\start.mjs
echo.
echo  使いすぎ番が止まりました。上に出た文を確かめてください。
goto end

:nonode
echo  Node.js が入っていません。
echo  1. https://nodejs.org/ja を開き、「LTS」と書かれた方を入れてください（無料）。
echo  2. 入れ終わったら、もう一度このファイルをダブルクリックしてください。

:end
echo.
if not defined TSUKAISUGI_NO_PAUSE pause
endlocal
