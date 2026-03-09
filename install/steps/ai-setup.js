/**
 * Step 4: AI Provider setup
 */
const path = require('path');
const { isTestMode, log, logStep, ask } = require('../utils');
const { ensureUvx } = require('../uvx');
const i18n = require('../i18n');

/**
 * Quick Setup AI — paste key → auto-detect → enable
 * @param {readline.Interface} rl
 * @param {string} lang
 * @param {object} manager - AiProviderManager instance
 * @param {Array} issues
 * @returns {Promise<string[]>} enabled provider IDs
 */
async function quickSetupAi(rl, lang, manager, issues) {
    const t = i18n[lang];
    const capNames = { image: t.capImage, tts: t.capTts, stt: t.capStt };
    const reg = manager.getRegistry();
    const enabledBefore = [...manager.getEnabledProviders()];

    console.log('');
    log(`  ${t.aiSetupIntro}`, 'cyan');
    console.log('');
    log(`  [1] ${t.aiSetupChoice1}`, 'white');
    log(`  [2] ${t.aiSetupChoice2}`, 'white');

    const choice = await ask(rl, '  > ', '2');
    if (choice !== '1') {
        log(`  ${t.aiSkipped}`, 'yellow');
        issues.push({
            type: 'info',
            msg: lang === 'zh' ? 'AI Provider 未設定' : 'AI Provider not configured',
            fix: lang === 'zh' ? '用 node install.js --manage-ai 設定' : 'Use node install.js --manage-ai to configure'
        });
        return enabledBefore;
    }

    // Key input loop
    while (true) {
        const apiKey = await ask(rl, `  ${t.aiPasteKey}`, '');
        if (!apiKey.trim()) break;

        const cleaned = apiKey.replace(/[^\x20-\x7E]/g, '').trim();
        const detected = manager.detectProvider(cleaned);

        if (!detected) {
            log(`  ✗ ${t.aiDetectFailed}`, 'red');
            continue;
        }

        let providerId;

        if (Array.isArray(detected)) {
            log(`  ${t.aiMultiMatch}`, 'yellow');
            for (let i = 0; i < detected.length; i++) {
                const p = reg.providers.find(pr => pr.id === detected[i]);
                log(`    [${i + 1}] ${p?.name || detected[i]}`, 'white');
            }
            const pChoice = await ask(rl, '    > ', '1');
            const pIdx = parseInt(pChoice, 10);
            providerId = (pIdx >= 1 && pIdx <= detected.length) ? detected[pIdx - 1] : detected[0];
        } else {
            providerId = detected;
        }

        const provider = reg.providers.find(p => p.id === providerId);
        if (!provider) continue;

        // Check if same provider already has a key (append mode)
        const alreadyEnabled = manager.getEnabledProviders().includes(providerId);
        if (alreadyEnabled) {
            const existingConfig = manager.getProviderConfig(providerId);
            if (existingConfig.apiKey) {
                const newKey = existingConfig.apiKey + ',' + cleaned;
                manager.updateApiKey(providerId, newKey);
                log(`  ${t.aiSameProvider.replace('{provider}', provider.name)}`, 'green');
            }
        } else {
            await manager.enableProvider(providerId, cleaned, {});
            const caps = provider.capabilities.map(c => capNames[c] || c).join('、');
            log(`  ${t.aiDetected.replace('{provider}', provider.name).replace('{caps}', caps)}`, 'green');

            if (provider.freeTier?.available) {
                log(`    (${lang === 'zh' ? '有免費額度' : 'Free tier available'}: ${provider.freeTier.note})`, 'yellow');
            }

            if (provider.capabilities.includes('stt')) {
                manager._writeEnv({ STT_PROVIDER: providerId });
            }
        }

        // More keys?
        console.log('');
        log(`  ${t.aiMoreKeys}`, 'white');
        log(`  [1] ${lang === 'zh' ? '有' : 'Yes'}  [2] ${lang === 'zh' ? '沒了' : 'No'}`, 'white');
        const more = await ask(rl, '  > ', '2');
        if (more !== '1') break;
    }

    // Check if any provider needs uvx
    const enabledNow = manager.getEnabledProviders();
    let needsUvx = false;
    for (const pid of enabledNow) {
        const provider = reg.providers.find(p => p.id === pid);
        if (provider?.mcpServer?.command === 'uvx') {
            needsUvx = true;
            break;
        }
    }

    if (needsUvx) {
        log(`  ${lang === 'zh' ? '安裝 uvx（AI 工具需要）...' : 'Installing uvx (needed for AI tools)...'}`, 'yellow');
        const uvxPath = await ensureUvx(lang);
        if (uvxPath) {
            await manager.syncMcpConfig();
            log(`  ✓ uvx ${lang === 'zh' ? '已安裝' : 'installed'}`, 'green');
        } else {
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? 'uvx 安裝失敗，部分 AI 功能暫時不可用' : 'uvx install failed, some AI features temporarily unavailable',
                fix: lang === 'zh' ? '之後用 node install.js --manage-ai 重新設定' : 'Use node install.js --manage-ai later'
            });
        }
    }

    return enabledNow;
}

/**
 * Run Step 4: AI Provider quick setup
 * @param {object} ctx - shared install context
 */
async function run(ctx) {
    const { rl, totalSteps, issues, completed, lang, t, installPath, isInsideProject, parentKiroPath } = ctx;

    logStep(4, totalSteps, t.step4Title);

    if (isTestMode) {
        log(`  [TEST] ${lang === 'zh' ? '跳過 AI Provider 設定' : 'Skipping AI Provider setup'}`, 'yellow');
    } else {
        try {
            const AiProviderManager = require(path.join(installPath, 'src', 'ai-provider-manager'));
            const parentKiroDir = isTestMode && isInsideProject
                ? path.join(installPath, '.kiro')
                : parentKiroPath;
            const aiManager = new AiProviderManager(installPath, parentKiroDir);
            const enabledProviders = await quickSetupAi(rl, lang, aiManager, issues);

            if (enabledProviders.length > 0) {
                const reg = aiManager.getRegistry();
                for (const pid of enabledProviders) {
                    const p = reg.providers.find(pr => pr.id === pid);
                    if (p) completed.push(`AI: ${p.name}`);
                }
            }
        } catch (e) {
            log(`  ⚠ AI Provider ${lang === 'zh' ? '設定失敗' : 'setup failed'}: ${e.message}`, 'yellow');
            issues.push({
                type: 'warning',
                msg: lang === 'zh' ? 'AI Provider 設定失敗' : 'AI Provider setup failed',
                fix: lang === 'zh' ? '用 node install.js --manage-ai 設定' : 'Use node install.js --manage-ai to configure'
            });
        }
    }
    console.log('');
}

module.exports = { run, quickSetupAi };
