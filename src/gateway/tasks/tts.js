/**
 * tts.js — Layer 2 Handler: 語音生成
 * 
 * 複用現有 TTS service（src/gateway/tts/），透過 AiRouter fallback 鏈。
 * 
 * Params:
 *   text (required) — 要合成的文字
 *   voice (optional) — 語音名稱（預設 Puck）
 *   filename (optional) — 輸出檔名（不含副檔名）
 * 
 * Implements: Requirements 6.2 (tts handler)
 */

const path = require('path');

// Lazy-init singleton — avoid re-creating router on every call
let _ttsService = null;

function getTtsService() {
  if (!_ttsService) {
    const { createRouter } = require('../../ai-router-init');
    const { TtsService } = require('../tts');

    const projectDir = path.join(__dirname, '..', '..', '..');
    const { router } = createRouter({
      projectDir,
      parentKiroDir: path.join(projectDir, '..', '.kiro'),
      capabilities: ['tts'],
    });

    _ttsService = new TtsService(router, { projectDir });
  }
  return _ttsService;
}

// Create TtsService using shared router from context
let _sharedTtsService = null;
let _sharedRouterRef = null;

function getOrCreateTtsServiceFromRouter(router) {
  // Re-create if router instance changed
  if (_sharedTtsService && _sharedRouterRef === router) return _sharedTtsService;
  const { TtsService } = require('../tts');
  const projectDir = path.join(__dirname, '..', '..', '..');
  _sharedTtsService = new TtsService(router, { projectDir });
  _sharedRouterRef = router;
  return _sharedTtsService;
}

module.exports = {
  name: 'tts',
  description: '語音生成（TTS → OGG Opus）',
  type: 'layer2',

  execute: async (params, context) => {
      let { text, voice, filename } = params;
      if (!text) throw new Error('Missing required param: text');

      let voiceStyle = '';

      // Read default voice & style from DNA.md or IDENTITY.md
      if (!voice) {
        const fs = require('fs');
        const steeringPaths = [
          path.join(__dirname, '..', '..', '..', '..', '.kiro', 'steering'),
          path.join(__dirname, '..', '..', '..', '..', '..', '.kiro', 'steering'),
        ];
        for (const steerDir of steeringPaths) {
          try {
            // Try DNA.md first
            const dnaPath = path.join(steerDir, 'DNA.md');
            if (fs.existsSync(dnaPath)) {
              const dnaContent = fs.readFileSync(dnaPath, 'utf-8');
              const voiceMatch = dnaContent.match(/voice:(\S+)/);
              const styleMatch = dnaContent.match(/voiceStyle:(.+)/);
              if (voiceMatch) voice = voiceMatch[1].trim();
              if (styleMatch) voiceStyle = styleMatch[1].trim();
              break;
            }
            // Fallback to IDENTITY.md (legacy)
            const idPath = path.join(steerDir, 'IDENTITY.md');
            if (fs.existsSync(idPath)) {
              const idContent = fs.readFileSync(idPath, 'utf-8');
              const voiceMatch = idContent.match(/\*\*Voice:\*\*\s*(.+)/);
              const styleMatch = idContent.match(/\*\*Voice Style:\*\*\s*(.+)/);
              if (voiceMatch) voice = voiceMatch[1].trim();
              if (styleMatch) voiceStyle = styleMatch[1].trim();
              break;
            }
          } catch (e) { /* ignore */ }
        }
        }
      }
      voice = voice || 'Puck';

      // Prepend voice style instruction
      const ttsText = voiceStyle ? `${voiceStyle}：${text}` : text;

      // Use shared router from context if available, else fallback to self-created
      const ttsService = (context && context.router)
        ? getOrCreateTtsServiceFromRouter(context.router)
        : getTtsService();

      const result = await ttsService.synthesize(ttsText, voice, {
        filename: filename || `task_tts_${Date.now()}`,
      });

      return {
        success: true,
        outputPath: result.filePath,
        message: `Generated TTS: ${voice}, ${result.duration}s, ${Math.round(result.size / 1024)}KB`,
      };
    }
};
