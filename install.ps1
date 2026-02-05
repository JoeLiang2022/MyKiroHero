# MyKiroHero 一鍵安裝腳本
# 用法: irm https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.ps1 | iex
#
# ============================================================
# 分層設計說明：
# ============================================================
# 🌐 通用步驟（任何 AI 工具都需要）：
#    - Step 1-3: Node.js, Git, 下載專案, npm install
#
# 🔷 Kiro 專屬步驟（未來支援其他 IDE 時需要替換）：
#    - Step 4: vscode-rest-control extension (Kiro/VS Code 專屬)
#    - Step 5: .kiro/steering/ 人格檔案 (Kiro 專屬路徑)
#    - Step 6: .kiro/settings/mcp.json (Kiro 專屬)
#    - Step 7: .vscode/tasks.json 自動啟動 (VS Code/Kiro 專屬)
#
# 未來支援 Cursor/Windsurf 時，只需修改 🔷 標記的步驟
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                              ║" -ForegroundColor Cyan
Write-Host "║   🤪 MyKiroHero 安裝程式                                     ║" -ForegroundColor Cyan
Write-Host "║   讓 Kiro AI 成為你的 WhatsApp 助手                          ║" -ForegroundColor Cyan
Write-Host "║                                                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# 🌐 Step 1: 設定安裝路徑 [通用]
# ============================================================
$defaultPath = "$env:LOCALAPPDATA\MyKiroHero"
Write-Host "預設安裝路徑: $defaultPath" -ForegroundColor Yellow
$customPath = Read-Host "按 Enter 使用預設路徑，或輸入自訂路徑"
$installPath = if ($customPath) { $customPath } else { $defaultPath }

# ============================================================
# 🌐 Step 2: 檢查並安裝必要工具 [通用]
# ============================================================
Write-Host ""
Write-Host "[1/10] 檢查必要工具..." -ForegroundColor Cyan

# 檢查 Node.js
$hasNode = $false
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green
        $hasNode = $true
    }
} catch {}

if (-not $hasNode) {
    Write-Host "  ✗ Node.js 未安裝" -ForegroundColor Red
    Write-Host "  自動下載並安裝 Node.js LTS..." -ForegroundColor Yellow
    
    # 下載 Node.js LTS (使用固定版本以確保穩定)
    $nodeUrl = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
    $nodeMsi = "$env:TEMP\node-install.msi"
    
    try {
        Write-Host "  下載中..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        
        Write-Host "  安裝中（需要管理員權限）..." -ForegroundColor Yellow
        Start-Process msiexec.exe -ArgumentList "/i", $nodeMsi, "/qn", "/norestart" -Wait -Verb RunAs
        
        # 重新載入 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        # 驗證安裝
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            Write-Host "  ✓ Node.js $nodeVersion 安裝完成！" -ForegroundColor Green
            $hasNode = $true
        }
        
        # 清理
        Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "  ✗ 自動安裝失敗: $_" -ForegroundColor Red
    }
    
    if (-not $hasNode) {
        Write-Host "  請手動安裝 Node.js: https://nodejs.org/" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# 檢查 Git
$hasGit = $false
try {
    $gitVersion = git --version 2>$null
    if ($gitVersion) {
        Write-Host "  ✓ $gitVersion" -ForegroundColor Green
        $hasGit = $true
    }
} catch {}

if (-not $hasGit) {
    Write-Host "  ✗ Git 未安裝" -ForegroundColor Red
    Write-Host "  自動下載並安裝 Git..." -ForegroundColor Yellow
    
    # 下載 Git (使用固定版本)
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe"
    $gitExe = "$env:TEMP\git-install.exe"
    
    try {
        Write-Host "  下載中..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $gitUrl -OutFile $gitExe -UseBasicParsing
        
        Write-Host "  安裝中（需要管理員權限）..." -ForegroundColor Yellow
        Start-Process $gitExe -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS" -Wait -Verb RunAs
        
        # 重新載入 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        # 驗證安裝
        $gitVersion = git --version 2>$null
        if ($gitVersion) {
            Write-Host "  ✓ $gitVersion 安裝完成！" -ForegroundColor Green
            $hasGit = $true
        }
        
        # 清理
        Remove-Item $gitExe -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "  ✗ 自動安裝失敗: $_" -ForegroundColor Red
    }
    
    if (-not $hasGit) {
        Write-Host "  請手動安裝 Git: https://git-scm.com/" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# ============================================================
# 🌐 Step 3: 下載 MyKiroHero [通用]
# ============================================================
Write-Host ""
Write-Host "[2/10] 下載 MyKiroHero..." -ForegroundColor Cyan

if (Test-Path $installPath) {
    Write-Host "  ! 目錄已存在，更新中..." -ForegroundColor Yellow
    Push-Location $installPath
    git pull origin main 2>$null
    Pop-Location
} else {
    git clone https://github.com/NorlWu-TW/MyKiroHero.git $installPath 2>$null
}
Write-Host "  ✓ 下載完成" -ForegroundColor Green

# ============================================================
# 🌐 Step 4: 安裝 Node.js 依賴 [通用]
# ============================================================
Write-Host ""
Write-Host "[3/10] 安裝 Node.js 依賴..." -ForegroundColor Cyan
Push-Location $installPath
npm install --silent 2>$null
Pop-Location
Write-Host "  ✓ 依賴安裝完成" -ForegroundColor Green

# ============================================================
# 🔷 Step 5: 安裝 vscode-rest-control Extension [Kiro 專屬]
# 未來支援 Cursor: 可能需要不同的 extension 或 API
# 未來支援 Windsurf: 待研究
# ============================================================
Write-Host ""
Write-Host "[4/10] 安裝 vscode-rest-control extension..." -ForegroundColor Cyan

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
    Write-Host "  找到 Kiro CLI" -ForegroundColor Green
    
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

# ============================================================
# 🔷 Step 6: 設定 AI 人格檔案 (Steering) [Kiro 專屬路徑]
# Kiro 使用 .kiro/steering/
# 其他 IDE 可能使用不同路徑，透過 STEERING_PATH 環境變數配置
# ============================================================
Write-Host ""
Write-Host "[5/10] 設定 AI 人格檔案..." -ForegroundColor Cyan

$steeringPath = "$installPath\.kiro\steering"
$templatePath = "$installPath\templates\steering"

# 檢查是否已有 steering 檔案
$hasExistingSteering = (Test-Path $steeringPath) -and ((Get-ChildItem $steeringPath -Force 2>$null | Measure-Object).Count -gt 0)

if ($hasExistingSteering) {
    Write-Host "  偵測到現有的 steering 檔案" -ForegroundColor Yellow
    $existingFiles = Get-ChildItem $steeringPath -Filter "*.md" | Select-Object -ExpandProperty Name
    Write-Host "  現有檔案: $($existingFiles -join ', ')" -ForegroundColor White
}

Write-Host ""
Write-Host "  AI 人格檔案決定了你的 AI 助手的個性和行為" -ForegroundColor White
Write-Host "  你可以選擇：" -ForegroundColor White
Write-Host "  [1] 使用範本（新使用者推薦）" -ForegroundColor White
Write-Host "  [2] 從 GitHub 還原記憶（已有備份的使用者）" -ForegroundColor White
Write-Host "  [3] 保留現有設定（不做任何變更）" -ForegroundColor White
Write-Host ""

$steeringChoice = Read-Host "請選擇 (1/2/3)"

switch ($steeringChoice) {
    "1" {
        # 使用範本（合併模式：只複製不存在的檔案）
        Write-Host ""
        Write-Host "  設定範本檔案..." -ForegroundColor Yellow
        
        # 建立目錄
        if (-not (Test-Path $steeringPath)) {
            New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
        }
        
        # 複製範本（只複製不存在的檔案）
        $templateFiles = Get-ChildItem $templatePath -Force -ErrorAction SilentlyContinue
        $copiedCount = 0
        $skippedCount = 0
        
        foreach ($file in $templateFiles) {
            if ($file.PSIsContainer) { continue }  # 跳過資料夾
            $targetFile = Join-Path $steeringPath $file.Name
            if (-not (Test-Path $targetFile)) {
                Copy-Item $file.FullName $targetFile
                Write-Host "    + $($file.Name)" -ForegroundColor Green
                $copiedCount++
            } else {
                Write-Host "    - $($file.Name) (已存在，跳過)" -ForegroundColor Gray
                $skippedCount++
            }
        }
        
        # 建立 memory 資料夾
        $memoryPath = "$steeringPath\memory"
        if (-not (Test-Path $memoryPath)) {
            New-Item -ItemType Directory -Path $memoryPath -Force | Out-Null
            Write-Host "    + memory/ (資料夾)" -ForegroundColor Green
        }
        
        Write-Host "  ✓ 複製了 $copiedCount 個檔案，跳過 $skippedCount 個" -ForegroundColor Green
        
        # 提示使用者自訂
        Write-Host ""
        Write-Host "  💡 建議編輯以下檔案來自訂你的 AI：" -ForegroundColor Cyan
        Write-Host "     $steeringPath\SOUL.md - AI 的人格和風格" -ForegroundColor White
        Write-Host "     $steeringPath\IDENTITY.md - AI 的名字和 Emoji" -ForegroundColor White
        Write-Host "     $steeringPath\USER.md - 關於你的資訊" -ForegroundColor White
    }
    "2" {
        # 從 GitHub 還原
        Write-Host ""
        Write-Host "  檢查 Git 認證..." -ForegroundColor Yellow
        
        $credentialHelper = git config --global credential.helper 2>$null
        $hasCredential = [bool]$credentialHelper
        
        if ($hasCredential) {
            Write-Host "  ✓ Git credential helper: $credentialHelper" -ForegroundColor Green
        } else {
            Write-Host "  ! 未偵測到 Git credential helper" -ForegroundColor Yellow
        }
        
        Write-Host ""
        Write-Host "  請選擇 GitHub 認證方式:" -ForegroundColor Cyan
        Write-Host "  [1] 使用現有的 Git credential" -ForegroundColor White
        Write-Host "  [2] 使用 GitHub Personal Access Token (PAT)" -ForegroundColor White
        Write-Host ""
        
        $authChoice = Read-Host "請選擇 (1/2)"
        
        $canProceed = $false
        
        switch ($authChoice) {
            "1" {
                if ($hasCredential) {
                    Write-Host "  ✓ 將使用現有的 Git credential" -ForegroundColor Green
                    $canProceed = $true
                } else {
                    Write-Host ""
                    Write-Host "  ⚠ 未偵測到 Git credential" -ForegroundColor Yellow
                    Write-Host "  下次 git 操作時可能會跳出登入視窗" -ForegroundColor White
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
                Write-Host "  需要的權限: repo (Full control of private repositories)" -ForegroundColor White
                Write-Host ""
                
                $pat = Read-Host "貼上你的 GitHub PAT"
                $githubUser = Read-Host "輸入你的 GitHub 帳號"
                
                if ($pat -and $githubUser) {
                    $credentialInput = "protocol=https`nhost=github.com`nusername=$githubUser`npassword=$pat`n"
                    $credentialInput | git credential approve 2>$null
                    Write-Host "  ✓ GitHub PAT 已設定" -ForegroundColor Green
                    $canProceed = $true
                } else {
                    Write-Host "  ✗ 需要 PAT 和 GitHub 帳號" -ForegroundColor Red
                }
            }
            default {
                Write-Host "  使用現有的 Git credential（預設）" -ForegroundColor Yellow
                $canProceed = $true
            }
        }
        
        $cloneSuccess = $false
        
        if ($canProceed) {
            Write-Host ""
            $memoryRepo = Read-Host "輸入記憶備份的 GitHub repo URL (例如 https://github.com/username/repo)"
            
            if ($memoryRepo) {
                # 備份現有檔案（如果有的話）
                $backupPath = $null
                if ($hasExistingSteering) {
                    $backupPath = "$steeringPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                    Write-Host "  備份現有檔案到 $backupPath" -ForegroundColor Yellow
                    Copy-Item $steeringPath $backupPath -Recurse
                }
                
                # 建立 .kiro 目錄
                $kiroPath = Split-Path $steeringPath -Parent
                if (-not (Test-Path $kiroPath)) {
                    New-Item -ItemType Directory -Path $kiroPath -Force | Out-Null
                }
                
                # 移除舊的 steering 目錄（如果存在）
                if (Test-Path $steeringPath) {
                    Remove-Item $steeringPath -Recurse -Force
                }
                
                # Clone
                Write-Host "  Clone 記憶庫..." -ForegroundColor Yellow
                Push-Location $kiroPath
                $cloneResult = git clone $memoryRepo steering 2>&1
                Pop-Location
                
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  ✓ 記憶庫還原完成！" -ForegroundColor Green
                    $cloneSuccess = $true
                    
                    # 檢查是否有 SOUL.md
                    if (Test-Path "$steeringPath\SOUL.md") {
                        Write-Host "  ✓ 找到 SOUL.md" -ForegroundColor Green
                    } else {
                        Write-Host "  ! 找不到 SOUL.md，補充範本檔案..." -ForegroundColor Yellow
                        # 補充缺少的範本檔案
                        $templateFiles = Get-ChildItem $templatePath -Force -ErrorAction SilentlyContinue
                        foreach ($file in $templateFiles) {
                            if ($file.PSIsContainer) { continue }  # 跳過資料夾
                            $targetFile = Join-Path $steeringPath $file.Name
                            if (-not (Test-Path $targetFile)) {
                                Copy-Item $file.FullName $targetFile
                                Write-Host "    + $($file.Name)" -ForegroundColor Green
                            }
                        }
                    }
                    
                    # 確保 memory 資料夾存在
                    $memoryPath = "$steeringPath\memory"
                    if (-not (Test-Path $memoryPath)) {
                        New-Item -ItemType Directory -Path $memoryPath -Force | Out-Null
                        Write-Host "  ✓ 建立 memory 資料夾" -ForegroundColor Green
                    }
                } else {
                    Write-Host "  ✗ Clone 失敗" -ForegroundColor Red
                    Write-Host "  $cloneResult" -ForegroundColor Red
                    
                    # 還原備份（如果有的話）
                    if ($backupPath -and (Test-Path $backupPath)) {
                        Write-Host "  還原備份..." -ForegroundColor Yellow
                        Copy-Item $backupPath $steeringPath -Recurse
                    }
                }
            }
        }
        
        # 如果 clone 失敗或沒有輸入 repo，fallback 到範本
        if (-not $cloneSuccess) {
            Write-Host ""
            Write-Host "  使用範本作為替代方案..." -ForegroundColor Yellow
            
            if (-not (Test-Path $steeringPath)) {
                New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
            }
            
            $templateFiles = Get-ChildItem $templatePath -Force -ErrorAction SilentlyContinue
            foreach ($file in $templateFiles) {
                if ($file.PSIsContainer) { continue }  # 跳過資料夾
                $targetFile = Join-Path $steeringPath $file.Name
                if (-not (Test-Path $targetFile)) {
                    Copy-Item $file.FullName $targetFile
                    Write-Host "    + $($file.Name)" -ForegroundColor Green
                }
            }
            
            # 建立 memory 資料夾
            $memoryPath = "$steeringPath\memory"
            if (-not (Test-Path $memoryPath)) {
                New-Item -ItemType Directory -Path $memoryPath -Force | Out-Null
            }
            
            Write-Host "  ✓ 範本設定完成" -ForegroundColor Green
        }
    }
    "3" {
        Write-Host "  保留現有設定" -ForegroundColor Yellow
        
        # 如果完全沒有 steering 檔案，還是要複製範本
        if (-not $hasExistingSteering) {
            Write-Host "  ! 但目前沒有任何 steering 檔案" -ForegroundColor Yellow
            Write-Host "  自動複製範本..." -ForegroundColor Yellow
            
            if (-not (Test-Path $steeringPath)) {
                New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
            }
            
            $templateFiles = Get-ChildItem $templatePath -Force -ErrorAction SilentlyContinue
            foreach ($file in $templateFiles) {
                if ($file.PSIsContainer) { continue }  # 跳過資料夾
                Copy-Item $file.FullName $steeringPath -Force
            }
            Write-Host "  ✓ 範本複製完成" -ForegroundColor Green
        }
        
        # 確保 memory 資料夾存在
        $memoryPath = "$steeringPath\memory"
        if (-not (Test-Path $memoryPath)) {
            New-Item -ItemType Directory -Path $memoryPath -Force | Out-Null
        }
    }
    default {
        Write-Host "  使用預設設定（範本）" -ForegroundColor Yellow
        
        if (-not (Test-Path $steeringPath)) {
            New-Item -ItemType Directory -Path $steeringPath -Force | Out-Null
        }
        
        # 合併模式（包含隱藏檔如 .gitignore）
        $templateFiles = Get-ChildItem $templatePath -Force -ErrorAction SilentlyContinue
        foreach ($file in $templateFiles) {
            if ($file.PSIsContainer) { continue }  # 跳過資料夾
            $targetFile = Join-Path $steeringPath $file.Name
            if (-not (Test-Path $targetFile)) {
                Copy-Item $file.FullName $targetFile
            }
        }
        
        # 建立 memory 資料夾
        $memoryPath = "$steeringPath\memory"
        if (-not (Test-Path $memoryPath)) {
            New-Item -ItemType Directory -Path $memoryPath -Force | Out-Null
        }
        
        Write-Host "  ✓ 範本設定完成" -ForegroundColor Green
    }
}

# ============================================================
# 🔷 Step 7: 設定 MCP Server [Kiro 專屬路徑]
# MCP 協議本身是通用的，但設定檔路徑是 Kiro 專屬
# ============================================================
Write-Host ""
Write-Host "[6/10] 設定 MCP Server..." -ForegroundColor Cyan

$mcpSettingsPath = "$installPath\.kiro\settings"
if (-not (Test-Path $mcpSettingsPath)) {
    New-Item -ItemType Directory -Path $mcpSettingsPath -Force | Out-Null
}

$mcpJsonPath = "$mcpSettingsPath\mcp.json"
$mcpContent = @"
{
  "mcpServers": {
    "mykiro-gateway": {
      "command": "node",
      "args": [
        "src/mcp-server.js"
      ],
      "env": {
        "GATEWAY_URL": "http://localhost:3000"
      },
      "disabled": false,
      "autoApprove": [
        "send_whatsapp",
        "send_whatsapp_media",
        "get_gateway_status"
      ]
    }
  }
}
"@
$mcpContent | Out-File -FilePath $mcpJsonPath -Encoding utf8
Write-Host "  ✓ MCP 設定完成" -ForegroundColor Green

# ============================================================
# 🔷 Step 8: 設定 VS Code tasks [VS Code/Kiro 專屬]
# 這是備用方案，主要使用 PM2 管理 Gateway
# ============================================================
Write-Host ""
Write-Host "[7/10] 設定 VS Code tasks..." -ForegroundColor Cyan

$vscodePath = "$installPath\.vscode"
if (-not (Test-Path $vscodePath)) {
    New-Item -ItemType Directory -Path $vscodePath -Force | Out-Null
}

$tasksJsonPath = "$vscodePath\tasks.json"
$tasksContent = @"
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Start Gateway",
      "type": "shell",
      "command": "node",
      "args": ["src/gateway/index.js"],
      "isBackground": true,
      "problemMatcher": [],
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "silent",
        "panel": "dedicated"
      }
    }
  ]
}
"@
$tasksContent | Out-File -FilePath $tasksJsonPath -Encoding utf8
Write-Host "  ✓ 自動啟動設定完成" -ForegroundColor Green

# ============================================================
# 🌐 Step 9: 寫入環境設定 [通用]
# 環境變數讓路徑可配置，支援不同 IDE
# ============================================================
Write-Host ""
Write-Host "[8/10] 寫入環境設定..." -ForegroundColor Cyan

$heartbeatPath = "$steeringPath\HEARTBEAT.md" -replace '\\', '/'
$steeringPathUnix = $steeringPath -replace '\\', '/'
$envPath = "$installPath\.env"
$envContent = @"
# MyKiroHero 環境設定
# 產生時間: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

# ============================================================
# 🌐 通用設定
# ============================================================

# AI 回覆前綴（用來識別 AI 發的訊息）
AI_PREFIX=*[AI Assistant]* 🤖

# Gateway 伺服器 port
GATEWAY_PORT=3000

# 訊息分段設定
MESSAGE_MAX_LENGTH=1500
MESSAGE_SPLIT_DELAY=500

# 錯誤通知（true/false）
ERROR_NOTIFICATION=true

# Heartbeat 設定檔路徑
HEARTBEAT_PATH=$heartbeatPath

# Steering 檔案路徑（AI 人格設定）
STEERING_PATH=$steeringPathUnix

# ============================================================
# 🔷 IDE 專屬設定（目前為 Kiro）
# ============================================================

# IDE 類型：kiro, cursor, windsurf, generic
IDE_TYPE=kiro

# IDE REST API port（vscode-rest-control extension）
IDE_REST_PORT=55139

# Telegram Bot Token（選填）
# TELEGRAM_BOT_TOKEN=your_token_here
"@
$envContent | Out-File -FilePath $envPath -Encoding utf8
Write-Host "  ✓ 已寫入 .env" -ForegroundColor Green

# ============================================================
# 🌐 Step 10: 安裝 PM2 並設定 Gateway 自動啟動 [通用]
# PM2 是 Node.js process manager，讓 Gateway 在背景持續運行
# ============================================================
Write-Host ""
Write-Host "[9/10] 設定 PM2 (Gateway 自動啟動)..." -ForegroundColor Cyan

# 檢查 PM2 是否已安裝
$hasPm2 = $false
try {
    $pm2Version = pm2 --version 2>$null
    if ($pm2Version) {
        Write-Host "  ✓ PM2 $pm2Version 已安裝" -ForegroundColor Green
        $hasPm2 = $true
    }
} catch {}

if (-not $hasPm2) {
    Write-Host "  安裝 PM2..." -ForegroundColor Yellow
    npm install -g pm2 --silent 2>$null
    
    # 驗證安裝
    try {
        $pm2Version = pm2 --version 2>$null
        if ($pm2Version) {
            Write-Host "  ✓ PM2 $pm2Version 安裝完成" -ForegroundColor Green
            $hasPm2 = $true
        }
    } catch {}
    
    if (-not $hasPm2) {
        Write-Host "  ! PM2 安裝失敗，Gateway 需要手動啟動" -ForegroundColor Yellow
    }
}

if ($hasPm2) {
    # 用 PM2 啟動 Gateway
    Write-Host "  設定 PM2 管理 Gateway..." -ForegroundColor Yellow
    Push-Location $installPath
    pm2 start ecosystem.config.js 2>$null
    pm2 save 2>$null
    Pop-Location
    Write-Host "  ✓ Gateway 已用 PM2 啟動" -ForegroundColor Green
    
    # 詢問是否設定開機自啟
    Write-Host ""
    Write-Host "  💡 PM2 可以讓 Gateway 在系統重啟後自動恢復" -ForegroundColor Cyan
    $setupStartup = Read-Host "  要設定 Gateway 開機自啟嗎? (y/N)"
    
    if ($setupStartup -eq "y" -or $setupStartup -eq "Y") {
        Write-Host "  設定開機自啟..." -ForegroundColor Yellow
        # Windows 上使用 pm2-startup 或手動設定
        # 先嘗試 pm2 startup
        $startupResult = pm2 startup 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ PM2 開機自啟設定完成" -ForegroundColor Green
        } else {
            # 如果 pm2 startup 失敗，建立啟動腳本
            Write-Host "  建立啟動腳本..." -ForegroundColor Yellow
            $startupScript = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\pm2-resurrect.cmd"
            "@echo off`npm2 resurrect" | Out-File -FilePath $startupScript -Encoding ascii
            Write-Host "  ✓ 已建立啟動腳本: $startupScript" -ForegroundColor Green
        }
    }
}

# ============================================================
# 🔷 Step 11: Kiro 開機自啟 (可選) [Kiro 專屬]
# ============================================================
Write-Host ""
Write-Host "[10/10] Kiro 開機自啟設定..." -ForegroundColor Cyan

Write-Host "  💡 設定 Kiro 開機自啟後，登入 Windows 就會自動開啟 Kiro" -ForegroundColor Cyan
Write-Host "  這樣 AI 助手就能在你登入後立即開始工作" -ForegroundColor White
$setupKiroStartup = Read-Host "  要設定 Kiro 開機自啟嗎? (y/N)"

if ($setupKiroStartup -eq "y" -or $setupKiroStartup -eq "Y") {
    # 找 Kiro 執行檔
    $kiroExe = "$env:LOCALAPPDATA\Programs\Kiro\Kiro.exe"
    
    if (Test-Path $kiroExe) {
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Kiro.lnk")
        $Shortcut.TargetPath = $kiroExe
        $Shortcut.WorkingDirectory = $installPath
        $Shortcut.Save()
        Write-Host "  ✓ Kiro 開機自啟設定完成" -ForegroundColor Green
        Write-Host "  工作目錄: $installPath" -ForegroundColor Gray
    } else {
        Write-Host "  ! 找不到 Kiro.exe，請確認 Kiro 已安裝" -ForegroundColor Yellow
        Write-Host "  預期路徑: $kiroExe" -ForegroundColor Gray
    }
} else {
    Write-Host "  跳過 Kiro 開機自啟設定" -ForegroundColor Gray
}

# ============================================================
# 完成
# ============================================================
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✓ 安裝完成！                                                ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "安裝路徑: $installPath" -ForegroundColor Cyan
Write-Host "Steering: $steeringPath" -ForegroundColor Cyan
Write-Host ""

if ($hasPm2) {
    Write-Host "Gateway 狀態:" -ForegroundColor Yellow
    pm2 list 2>$null
    Write-Host ""
    Write-Host "下一步:" -ForegroundColor Yellow
    Write-Host "  1. 用 Kiro 開啟資料夾: $installPath" -ForegroundColor White
    Write-Host "  2. 首次使用需要掃描 QR Code 登入 WhatsApp" -ForegroundColor White
    Write-Host "     執行: pm2 logs gateway --lines 50" -ForegroundColor Cyan
    Write-Host "     找到 QR Code 後用手機掃描" -ForegroundColor White
    Write-Host "  3. 開始和你的 AI 助手對話！" -ForegroundColor White
    Write-Host ""
    Write-Host "常用指令:" -ForegroundColor Yellow
    Write-Host "  pm2 logs gateway    - 查看 Gateway 日誌" -ForegroundColor Gray
    Write-Host "  pm2 restart gateway - 重啟 Gateway" -ForegroundColor Gray
    Write-Host "  pm2 stop gateway    - 停止 Gateway" -ForegroundColor Gray
} else {
    Write-Host "下一步:" -ForegroundColor Yellow
    Write-Host "  1. 用 Kiro 開啟資料夾: $installPath" -ForegroundColor White
    Write-Host "  2. 在 Kiro 終端機執行:" -ForegroundColor White
    Write-Host ""
    Write-Host "     node src/gateway/index.js" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  3. 用手機掃描 QR Code 登入 WhatsApp" -ForegroundColor White
    Write-Host "  4. 開始和你的 AI 助手對話！" -ForegroundColor White
}
Write-Host ""

# 如果沒有 PM2，詢問是否立即啟動
if (-not $hasPm2) {
    $startNow = Read-Host "是否立即啟動 Gateway? (y/N)"
    if ($startNow -eq "y" -or $startNow -eq "Y") {
        Write-Host ""
        Write-Host "啟動 Gateway..." -ForegroundColor Cyan
        Write-Host "（首次啟動會顯示 QR Code，請用手機掃描）" -ForegroundColor Yellow
        Write-Host ""
        Push-Location $installPath
        node src/gateway/index.js
        Pop-Location
    }
}
