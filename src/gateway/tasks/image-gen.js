/**
 * image-gen.js — Layer 2 Handler: 圖片生成
 *
 * 透過 AiRouter fallback 鏈呼叫 Gemini / OpenAI Image API。
 *
 * Params:
 *   prompt  (required) — 圖片描述
 *   model   (optional) — 指定 provider: 'gemini' | 'openai'（預設依 chain 順序）
 *   size    (optional) — 圖片尺寸（預設 '1024x1024'）
 *
 * Output: PNG 檔案存到 temp/image/YYYY-MM-DD/
 *
 * Implements: Requirements 6.2 (image-gen handler)
 */

const fs = require('fs');
const path = require('path');
const { getTodayDate } = require('../../utils/timezone');

// ── Lazy-init singleton ─────────────────────────────────────────
let _router = null;
let _projectDir = null;

function getRouter() {
  if (!_router) {
    const { createRouter } = require('../../ai-router-init');
    _projectDir = path.join(__dirname, '..', '..', '..');
    const { router } = createRouter({
      projectDir: _projectDir,
      parentKiroDir: path.join(_projectDir, '..', '.kiro'),
      capabilities: ['image'],
    });
    _router = router;
  }
  return _router;
}

function getProjectDir() {
  if (!_projectDir) getRouter();   // ensure init
  return _projectDir;
}

// ── API constants ───────────────────────────────────────────────
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_API_URL = 'https://api.openai.com/v1/images/generations';

// ── Provider-specific generators ────────────────────────────────

/**
 * Gemini image generation via generateContent API
 * responseModalities: ['IMAGE'] + TEXT for the model to understand the prompt
 */
async function generateGemini(apiKey, modelId, prompt, size, timeout = 60000) {
  const url = `${GEMINI_API_BASE}/models/${modelId}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Gemini Image API error ${res.status}: ${errText.substring(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      p => p.inlineData?.mimeType?.startsWith('image/')
    );
    if (!imagePart) {
      throw new Error('No image in Gemini response');
    }

    return Buffer.from(imagePart.inlineData.data, 'base64');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI image generation via /v1/images/generations
 */
async function generateOpenAI(apiKey, modelId, prompt, size, timeout = 60000) {
  const body = {
    model: modelId || 'gpt-image-1',
    prompt,
    n: 1,
    size: size || '1024x1024',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`OpenAI Image API error ${res.status}: ${errText.substring(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, 'base64');

    // Some models return URL instead of b64
    const imageUrl = data.data?.[0]?.url;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Failed to download image from URL: ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }

    throw new Error('No image data in OpenAI response');
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

/** Map WxH string to Gemini imageDimension object (best-effort) */
function parseGeminiSize(size) {
  if (!size) return {};
  const m = size.match(/^(\d+)x(\d+)$/i);
  if (!m) return {};
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

/** Pick the right generator function based on provider id */
function getGenerator(provider) {
  if (provider === 'openai') return generateOpenAI;
  // Default: gemini (also covers stability/xai that use similar patterns)
  return generateGemini;
}

// ── Handler export ──────────────────────────────────────────────

module.exports = {
  name: 'image-gen',
  description: '圖片生成（Gemini / OpenAI Image API → PNG）',
  type: 'layer2',

  execute: async (params, context) => {
    const { prompt, model, size = '1024x1024' } = params;
    if (!prompt) throw new Error('Missing required param: prompt');

    // Use shared router from context if available, else fallback to self-created
    const router = (context && context.router) ? context.router : getRouter();
    const projectDir = (context && context.projectDir) ? context.projectDir : getProjectDir();

    // Use router.execute for automatic fallback across providers/keys
    const imageBuffer = await router.execute('image', async (candidate) => {
      // If user specified a provider, skip non-matching candidates
      if (model && candidate.provider !== model) {
        const err = new Error(`Skipping ${candidate.provider} — user requested ${model}`);
        err.skipCandidate = true;
        throw err;
      }

      const generator = getGenerator(candidate.provider);
      return generator(candidate.key, candidate.model, prompt, size);
    });

    // Save PNG to temp/image/YYYY-MM-DD/
    const today = getTodayDate();
    const outputDir = path.join(projectDir, 'temp', 'image', today);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `img_${Date.now()}.png`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, imageBuffer);

    const sizeKB = Math.round(imageBuffer.length / 1024);
    return {
      success: true,
      outputPath,
      message: `Generated image: ${sizeKB}KB, ${size}, saved to ${filename}`,
    };
  },
};
