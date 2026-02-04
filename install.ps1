# MyKiroHero 一鍵安裝腳本
# 用法: irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                              ║" -ForegroundColor Cyan
Write-Host "║   🤪 MyKiroHero 安裝程式                                     ║" -ForegroundColor Cyan
Write-Host "║   讓 Kiro AI 成為你的 WhatsApp 助手                          ║" -ForegroundColor Cyan
Write-Host "║                                                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 設定安裝路徑
$defaultPath = "$env:LOCALAPPDATA\MyKiroHero"
Write-Host "預設安裝路徑: $defaultPath" -ForegroundColor Yellow
$customPath = Read-Host "按 Enter 使用預設路徑，或輸入自訂路徑"
$installPath = if ($customPath) { $customPath } else { $defaultPath }

# Step 1: 檢查 Node.js
Write-Host ""
Write-Host "[1/5] 檢查 Node.js..." -ForegroundColor Cyan
try {
    $nodeVersion = node --version 2>$null
    Write-Host "  ✓ Node.js $nodeVersion 已安裝" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安裝" -ForegroundColor Red
    Write-Host "  請先安裝 Node.js: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Step 2: 檢查 Git
Write-Host ""
Write-Host "[2/5] 檢查 Git..." -ForegroundColor Cyan
try {
    $gitVersion = git --version 2>$null
    Write-Host "  ✓ $gitVersion 已安裝" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Git 未安裝" -ForegroundColor Red
    Write-Host "  請先安裝 Git: https://git-scm.com/" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# Step 3: Clone 專案
Write-Host ""
Write-Host "[3/5] 下載 MyKiroHero..." -ForegroundColor Cyan
if (Test-Path $installPath) {
    Write-Host "  ! 目錄已存在，更新中..." -ForegroundColor Yellow
    Push-Location $installPath
    git pull origin main 2>$null
    Pop-Location
} else {
    git clone https://github.com/NorlWu-TW/MyKiroHero.git $installPath
}
Write-Host "  ✓ 下載完成" -ForegroundColor Green

# Step 4: 安裝依賴
Write-Host ""
Write-Host "[4/5] 安裝 Node.js 依賴..." -ForegroundColor Cyan
Push-Location $installPath
npm install --silent 2>$null
Pop-Location
Write-Host "  ✓ 依賴安裝完成" -ForegroundColor Green

# Step 5: 檢查/安裝 vscode-rest-control extension
Write-Host ""
Write-Host "[5/5] 檢查 vscode-rest-control extension..." -ForegroundColor Cyan
$vsixPath = "$installPath\temp-vscode-rest-control\vscode-rest-control-0.0.18.vsix"
$vsixUrl = "https://github.com/dpar39/vscode-rest-control/releases/download/v0.0.18/vscode-rest-control-0.0.18.vsix"

# 嘗試找 Kiro CLI
$kiroCli = $null
$possiblePaths = @(
    "$env:LOCALAPPDATA\Programs\Kiro\resources\app\bin\kiro.cmd",
    "$env:LOCALAPPDATA\Programs\Kiro\bin\kiro.cmd",
    "kiro"
)
foreach ($p in $possiblePaths) {
    try {
        $null = & $p --version 2>$null
        $kiroCli = $p
        break
    } catch {}
}

if ($kiroCli) {
    Write-Host "  找到 Kiro CLI: $kiroCli" -ForegroundColor Green
    
    # 下載 vsix
    $tempVsix = "$env:TEMP\vscode-rest-control-0.0.18.vsix"
    if (-not (Test-Path $tempVsix)) {
        Write-Host "  下載 extension..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $vsixUrl -OutFile $tempVsix -UseBasicParsing
    }
    
    Write-Host "  安裝 extension..." -ForegroundColor Yellow
    & $kiroCli --install-extension $tempVsix 2>$null
    Write-Host "  ✓ Extension 安裝完成" -ForegroundColor Green
} else {
    Write-Host "  ! 找不到 Kiro CLI，請手動安裝 extension" -ForegroundColor Yellow
    Write-Host "  下載: $vsixUrl" -ForegroundColor Yellow
    Write-Host "  然後執行: kiro --install-extension <vsix路徑>" -ForegroundColor Yellow
}

# 完成
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✓ 安裝完成！                                                ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "安裝路徑: $installPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "  1. 開啟 Kiro IDE" -ForegroundColor White
Write-Host "  2. 執行以下指令啟動 Gateway:" -ForegroundColor White
Write-Host ""
Write-Host "     cd `"$installPath`"" -ForegroundColor Cyan
Write-Host "     node src/gateway/index.js" -ForegroundColor Cyan
Write-Host ""
Write-Host "  3. 用手機掃描 QR Code 登入 WhatsApp" -ForegroundColor White
Write-Host ""

# 詢問是否立即啟動
$startNow = Read-Host "是否立即啟動 Gateway? (y/N)"
if ($startNow -eq "y" -or $startNow -eq "Y") {
    Write-Host ""
    Write-Host "啟動 Gateway..." -ForegroundColor Cyan
    Push-Location $installPath
    node src/gateway/index.js
    Pop-Location
}
