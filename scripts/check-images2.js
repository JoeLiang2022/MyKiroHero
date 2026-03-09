const https = require('https');
const fs = require('fs');

const html = fs.readFileSync('public/fukuoka.html', 'utf8');
const urls = new Set();
const srcRegex = /src=['"]([^'"]+wikimedia[^'"]+)['"]/g;
const bgRegex = /url\(['"]([^'"]+wikimedia[^'"]+)['"]\)/g;
let m;
while ((m = srcRegex.exec(html)) !== null) urls.add(m[1]);
while ((m = bgRegex.exec(html)) !== null) urls.add(m[1]);

// Deduplicate by base filename
const unique = [...urls].filter((v, i, a) => {
  const base = v.split('/').pop();
  return a.findIndex(u => u.split('/').pop() === base) === i;
});

console.log(`Checking ${unique.length} unique images with browser User-Agent...\n`);

async function checkUrl(url) {
  return new Promise((resolve) => {
    const options = {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000
    };
    const req = https.request(url, options, (res) => {
      res.destroy(); // don't download body
      resolve({ url: url.split('/').pop(), status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 400 });
    });
    req.on('error', (e) => resolve({ url: url.split('/').pop(), status: 'ERR', ok: false }));
    req.on('timeout', () => { req.destroy(); resolve({ url: url.split('/').pop(), status: 'TIMEOUT', ok: false }); });
    req.end();
  });
}

(async () => {
  const results = await Promise.all(unique.map(checkUrl));
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    console.log(`${icon} [${r.status}] ${r.url}`);
  }
  const broken = results.filter(r => !r.ok);
  console.log(`\nBroken: ${broken.length} / ${results.length}`);
})();
