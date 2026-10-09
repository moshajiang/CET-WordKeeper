@echo off
rem CET WordKeeper 启动脚本（双击运行）
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo [错误] 未找到 Electron，请先执行：npm install
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo 首次运行，正在构建前端界面...
  call npm run build
)

rem 清除可能存在的 Electron 兼容模式变量
set ELECTRON_RUN_AS_NODE=
start "" "node_modules\electron\dist\electron.exe" .
