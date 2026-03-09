/**
 * i18n strings for MyKiroHero installer
 */
const i18n = {
    zh: {
        title: '🤖 MyKiroHero 安裝程式',
        subtitle: '讓 Kiro AI 成為你的 WhatsApp 助手',
        // Step titles
        step1Title: '語言 + 環境檢查...',
        step2Title: '取得專案 + 安裝依賴...',
        step3Title: '個人化設定...',
        step4Title: 'AI Provider 設定...',
        step5Title: '啟動 + 安裝報告',
        // Step 1
        gitNotFound: 'Git 未安裝',
        gitChatAssist: '💡 請複製以下文字到 Kiro 聊天視窗：',
        gitChatMsg: '幫我找到 Git 的安裝路徑',
        gitPathPrompt: 'Git 路徑 (Enter 跳過): ',
        gitPathPromptEn: 'Git path (Enter to skip): ',
        kiroFound: 'Kiro CLI 找到',
        // Step 2
        dirExists: '目錄已存在，更新中...',
        downloadDone: '專案就緒',
        depsDone: '依賴安裝完成',
        extDone: 'Extension 安裝完成',
        extFailed: 'Extension 安裝失敗',
        extManual: '請手動安裝: kiro --install-extension dpar39.vscode-rest-control',
        // Step 3
        hasConfig: '已有設定檔，跳過',
        copiedFiles: '複製了 {count} 個檔案',
        envDone: '已寫入 .env',
        // Step 4
        aiSetupIntro: '想讓助手能產生圖片和辨識語音嗎？需要 AI API key。',
        aiSetupChoice1: '有 key，我來貼',
        aiSetupChoice2: '先跳過',
        aiPasteKey: '請貼上 API Key: ',
        aiDetected: '✓ 偵測到 {provider}，已啟用：{caps}',
        aiDetectFailed: '無法辨識這組 key，請確認格式',
        aiMultiMatch: '這組 key 可能是以下 Provider，請選擇：',
        aiMoreKeys: '還有其他 key 嗎？',
        aiSkipped: '跳過（可稍後用 node install.js --manage-ai 設定）',
        aiSameProvider: '✓ 已附加到 {provider}（多 key 模式）',
        // Step 5
        done: '安裝完成！',
        installPath: '安裝路徑',
        reportComplete: '✅ 完成項目',
        reportWarning: '⚠️ 需注意',
        reportNext: '📋 下一步',
        installFailed: '安裝失敗',
        // Capability names
        capImage: '圖片生成',
        capTts: '語音合成',
        capStt: '語音辨識',
    },
    en: {
        title: '🤖 MyKiroHero Installer',
        subtitle: 'Turn Kiro AI into your WhatsApp assistant',
        // Step titles
        step1Title: 'Language + Environment check...',
        step2Title: 'Get project + Install dependencies...',
        step3Title: 'Personalization...',
        step4Title: 'AI Provider setup...',
        step5Title: 'Launch + Install report',
        // Step 1
        gitNotFound: 'Git not installed',
        gitChatAssist: '💡 Copy the following to Kiro chat:',
        gitChatMsg: 'Help me find the Git installation path',
        gitPathPrompt: 'Git path (Enter to skip): ',
        gitPathPromptEn: 'Git path (Enter to skip): ',
        kiroFound: 'Kiro CLI found',
        // Step 2
        dirExists: 'Directory exists, updating...',
        downloadDone: 'Project ready',
        depsDone: 'Dependencies installed',
        extDone: 'Extension installed',
        extFailed: 'Extension install failed',
        extManual: 'Manual install: kiro --install-extension dpar39.vscode-rest-control',
        // Step 3
        hasConfig: 'Config exists, skipping',
        copiedFiles: 'Copied {count} files',
        envDone: 'Wrote .env',
        // Step 4
        aiSetupIntro: 'Want image generation and voice recognition? Need an AI API key.',
        aiSetupChoice1: 'I have a key',
        aiSetupChoice2: 'Skip for now',
        aiPasteKey: 'Paste your API Key: ',
        aiDetected: '✓ Detected {provider}, enabled: {caps}',
        aiDetectFailed: 'Cannot identify this key, please check the format',
        aiMultiMatch: 'This key could be from multiple providers, please choose:',
        aiMoreKeys: 'Any more keys?',
        aiSkipped: 'Skipped (use node install.js --manage-ai later)',
        aiSameProvider: '✓ Appended to {provider} (multi-key mode)',
        // Step 5
        done: 'Installation complete!',
        installPath: 'Install path',
        reportComplete: '✅ Completed',
        reportWarning: '⚠️ Attention needed',
        reportNext: '📋 Next steps',
        installFailed: 'Installation failed',
        // Capability names
        capImage: 'Image generation',
        capTts: 'Text-to-speech',
        capStt: 'Speech-to-text',
    }
};

module.exports = i18n;
