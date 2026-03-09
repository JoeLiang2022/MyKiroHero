#!/bin/bash
# MyKiroHero 一鍵安裝 (macOS/Linux)
# 用法: curl -fsSL https://raw.githubusercontent.com/NorlWu-TW/MyKiroHero/main/install.sh | bash

echo ""
echo "  MyKiroHero Installer"
echo ""

# 檢查基本工具（只檢查存在，版本由 install.js 檢查）
if ! command -v node &> /dev/null; then
    echo "  [X] Node.js not found"
    echo "      Please install from: https://nodejs.org/"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "  [X] Git not found"
    echo "      macOS: xcode-select --install"
    echo "      Linux: sudo apt install git"
    exit 1
fi

# Clone 或更新
INSTALL_PATH="$HOME/.mykiro-hero"

if [ -f "$INSTALL_PATH/package.json" ]; then
    echo "  Updating..."
    cd "$INSTALL_PATH"
    git pull origin main 2>/dev/null || echo "  [!] Update failed, continuing with existing version"
else
    # 清理可能存在的不完整目錄
    if [ -d "$INSTALL_PATH" ]; then
        rm -rf "$INSTALL_PATH"
    fi
    echo "  Downloading... (this may take a minute)"
    if ! git clone --progress https://github.com/NorlWu-TW/MyKiroHero.git "$INSTALL_PATH" 2>&1; then
        echo "  [X] Download failed"
        echo "      Please check your internet connection"
        exit 1
    fi
fi

# 確認 package.json 存在
if [ ! -f "$INSTALL_PATH/package.json" ]; then
    echo "  [X] Installation incomplete"
    echo "      Please try again"
    exit 1
fi

# 執行 install.js
echo ""
cd "$INSTALL_PATH"
node install.js
