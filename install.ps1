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
Write-Host "[5/6] 檢查 vscode-rest-control extension..." -ForegroundColor Cyan
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

# Step 6: 設定記憶備份（可選）
Write-Host ""
Write-Host "[6/6] 設定記憶備份..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  記憶備份功能可以自動將 AI 的記憶同步到 GitHub" -ForegroundColor White
Write-Host "  這樣即使換電腦，AI 也能記得你們的對話歷史" -ForegroundColor White
Write-Host ""

$setupMemory = Read-Host "是否設定記憶備份? (y/N)"
if ($setupMemory -eq "y" -or $setupMemory -eq "Y") {
    
    # 檢查 Git credential
    Write-Host ""
    Write-Host "  檢查 Git 認證設定..." -ForegroundColor Yellow
    
    $credentialHelper = git config --global credential.helper 2>$null
    $hasCredential = $false
    
    if ($credentialHelper) {
        Write-Host "  ✓ Git credential helper: $credentialHelper" -ForegroundColor Green
        $hasCredential = $true
    } else {
        Write-Host "  ! 未偵測到 Git credential helper" -ForegroundColor Yellow
    }
    
    # 提供認證選項
    Write-Host ""
    Write-Host "  請選擇 GitHub 認證方式:" -ForegroundColor Cyan
    Write-Host "  [1] 使用現有的 Git credential（已登入 GitHub Desktop 或 git credential manager）" -ForegroundColor White
    Write-Host "  [2] 使用 GitHub Personal Access Token (PAT)" -ForegroundColor White
    Write-Host "  [3] 稍後手動設定" -ForegroundColor White
    Write-Host ""
    
    $authChoice = Read-Host "請選擇 (1/2/3)"
    
    $canProceed = $false
    $repoUrlToUse = $null
    
    switch ($authChoice) {
        "1" {
            if ($hasCredential) {
                Write-Host "  ✓ 將使用現有的 Git credential" -ForegroundColor Green
                $canProceed = $true
            } else {
                Write-Host ""
                Write-Host "  ⚠ 未偵測到 Git credential，你可能需要先設定：" -ForegroundColor Yellow
                Write-Host "    方法 1: 安裝 GitHub Desktop (會自動設定)" -ForegroundColor White
                Write-Host "    方法 2: 執行 'git config --global credential.helper manager'" -ForegroundColor White
                Write-Host "    方法 3: 下次 git push 時會跳出登入視窗" -ForegroundColor White
                Write-Host ""
                $continueAnyway = Read-Host "是否繼續? (y/N)"
                if ($continueAnyway -eq "y" -or $continueAnyway -eq "Y") {
                    $canProceed = $true
                }
            }
        }
        "2" {
            Write-Host ""
            Write-Host "  請到 GitHub 建立 Personal Access Token:" -ForegroundColor Yellow
            Write-Host "  https://github.com/settings/tokens/new" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  需要的權限: repo (Full control of private repositories)" -ForegroundColor White
            Write-Host ""
            
            $pat = Read-Host "貼上你的 GitHub PAT"
            
            if ($pat) {
                # 設定 Git credential 使用 PAT
                Write-Host "  設定 Git credential..." -ForegroundColor Yellow
                
                # 取得 GitHub username
                $githubUser = Read-Host "輸入你的 GitHub 帳號"
                
                if ($githubUser) {
                    # 儲存 credential（使用 git credential store 或 manager）
                    $credentialInput = "protocol=https`nhost=github.com`nusername=$githubUser`npassword=$pat`n"
                    $credentialInput | git credential approve 2>$null
                    
                    Write-Host "  ✓ GitHub PAT 已設定" -ForegroundColor Green
                    $canProceed = $true
                } else {
                    Write-Host "  ✗ 需要 GitHub 帳號" -ForegroundColor Red
                }
            } else {
                Write-Host "  ✗ 需要 PAT" -ForegroundColor Red
            }
        }
        "3" {
            Write-Host "  跳過認證設定，稍後請手動設定 Git credential" -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  設定方法:" -ForegroundColor White
            Write-Host "    1. 安裝 GitHub Desktop，或" -ForegroundColor White
            Write-Host "    2. 執行 git push 時會跳出登入視窗" -ForegroundColor White
            $canProceed = $true
        }
        default {
            Write-Host "  跳過記憶備份設定" -ForegroundColor Yellow
        }
    }
    
    if ($canProceed) {
        Write-Host ""
        Write-Host "  請先在 GitHub 建立一個 repo 來存放記憶" -ForegroundColor Yellow
        Write-Host "  例如: https://github.com/你的帳號/Moltbot" -ForegroundColor Yellow
        Write-Host ""
        
        $memoryRepo = Read-Host "輸入 GitHub repo URL (例如 https://github.com/username/repo)"
        
        if ($memoryRepo) {
            # 取得 Kiro workspace 路徑
            $kiroWorkspace = Read-Host "輸入 Kiro workspace 路徑 (預設: $installPath)"
            if (-not $kiroWorkspace) { $kiroWorkspace = $installPath }
            
            $steeringPath = "$kiroWorkspace\.kiro\steering"
            
            # 建立 .kiro/steering 目錄
            if (-not (Test-Path $steeringPath)) {
                New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
            }
            
            # Clone 記憶 repo 到 steering 目錄
            Write-Host ""
            Write-Host "  Clone 記憶庫到 $steeringPath ..." -ForegroundColor Yellow
            
            # 如果目錄已有內容，先備份
            if ((Get-ChildItem $steeringPath -Force | Measure-Object).Count -gt 0) {
                Write-Host "  ! steering 目錄已有內容，備份中..." -ForegroundColor Yellow
                $backupPath = "$steeringPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                Move-Item $steeringPath $backupPath
                New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
            }
            
            Push-Location (Split-Path $steeringPath -Parent)
            $cloneResult = git clone $memoryRepo steering 2>&1
            Pop-Location
            
            if ($LASTEXITCODE -eq 0) {
                if (Test-Path "$steeringPath\SOUL.md") {
                    Write-Host "  ✓ 記憶庫設定完成！" -ForegroundColor Green
                } else {
                    Write-Host "  ✓ Clone 完成" -ForegroundColor Green
                    Write-Host "  ! 找不到 SOUL.md，可能是新的 repo" -ForegroundColor Yellow
                    Write-Host "  需要手動建立記憶檔案（SOUL.md, MEMORY.md 等）" -ForegroundColor Yellow
                }
                
                # 更新 heartbeatPath 設定
                $heartbeatPath = "$steeringPath\HEARTBEAT.md" -replace '\\', '/'
                
                Write-Host ""
                Write-Host "  更新 heartbeatPath 設定..." -ForegroundColor Yellow
                
                # 寫入 .env 檔案
                $envPath = "$installPath\.env"
                $envContent = @"
# MyKiroHero 環境設定
HEARTBEAT_PATH=$heartbeatPath
"@
                $envContent | Out-File -FilePath $envPath -Encoding utf8
                Write-Host "  ✓ 已寫入 .env" -ForegroundColor Green
            } else {
                Write-Host "  ✗ Clone 失敗: $cloneResult" -ForegroundColor Red
                Write-Host "  請檢查 repo URL 和認證設定" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  跳過記憶備份設定" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  跳過記憶備份設定" -ForegroundColor Yellow
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
Write-Host "  1. 開啟 Kiro IDE 並開啟 workspace: $installPath" -ForegroundColor White
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
