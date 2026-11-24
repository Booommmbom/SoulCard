@echo off
chcp 65001 >nul
title SoulCard — Cloud-First AI Companion Studio
echo.
echo ==============================================================
echo   SoulCard — 一键懒人启动 (零依赖 · 无需显卡 · 纯云端全模型)
echo   支持 Claude / GPT / Gemini / Grok / DeepSeek / 任意中转站
echo ==============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [提示] 未检测到 Node.js，请先安装 Node.js 20 或以上版本：
  echo        https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [提示] 当前 Node.js 版本过低，请升级到 Node.js 20+：https://nodejs.org/
  pause
  exit /b 1
)

echo [启动中] 无需 npm install，正在启动本地陪伴工作室并自动打开浏览器...
echo          按 Ctrl+C 可随时安全关闭。
echo.
cd /d "%~dp0"
node src/runtime/web-server.mjs --open
if errorlevel 1 (
  echo.
  echo [退出] 服务异常退出，请查看上方报错信息。
  pause
)
