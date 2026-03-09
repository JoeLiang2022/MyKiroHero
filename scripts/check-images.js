const https = require('https');
const http = require('http');
const fs = require('fs');

const html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Extract all image URLs (src and background-image)
const urls = new Set();
const srcRegex = /src=['"]([^'"]+wikimedia[^'"]+)['"]/g;
const bgRegex = /url\(['"]([^'"]+wikimedia[^'"]+)['"]\)/g;

let m;
while ((m = srcRegex.exec(html)) !== null) urls.add(m[1]);
while ((m = bgRegex.exec(html)) !== null) urls.add(m[1]);

console.log(`Found ${urls.size} unique Wikimedia image URLs\n`);

async function checkUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
      resolve({ url, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
    });
    req.on('error', (e) => resolve({ url, status: 'ERROR', ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ url, status: 'TIMEOUT', ok: false }); });
    req.end();
  });
}

(async () => {
  const results = await Promise.all([...urls].map(checkUrl));
  console.log('=== RESULTS ===');
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} [${r.status}] ${r.url}`);
  }
  const broken = results.filter(r => !r.ok);
  console.log(`\n${broken.length} broken out of ${results.length} total`);
})();
