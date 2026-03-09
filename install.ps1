# MyKiroHero 一鍵安裝 (Windows)
# 用法: irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "  MyKiroHero Installer" -ForegroundColor Cyan
Write-Host ""

# 檢查基本工具
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [X] Node.js not found" -ForegroundColor Red
    Write-Host "      Install from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [X] Git not found" -ForegroundColor Red
    Write-Host "      Install from: https://git-scm.com/" -ForegroundColor Yellow
    exit 1
}

# Clone 或更新
$installPath = "$env:LOCALAPPDATA\MyKiroHero"

if (Test-Path "$installPath\package.json") {
    Write-Host "  Updating..." -ForegroundColor Yellow
    Push-Location $installPath
    git pull origin main 2>$null
    Pop-Location
} else {
    # 清理可能存在的不完整目錄
    if (Test-Path $installPath) {
        Remove-Item -Recurse -Force $installPath 2>$null
    }
    Write-Host "  Downloading... (this may take a minute)" -ForegroundColor Yellow
    git clone --progress https://github.com/NorlWu-TW/MyKiroHero.git $installPath
    if (-not (Test-Path "$installPath\package.json")) {
        Write-Host "  [X] Download failed" -ForegroundColor Red
        Write-Host "      Please check your internet connection" -ForegroundColor Yellow
        exit 1
    }
}

# 執行 install.js
Write-Host ""
Set-Location $installPath
node install.js
