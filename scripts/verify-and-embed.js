const https = require('https');
const fs = require('fs');

let html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Extract all unique wikimedia image URLs
const regex = /(https:\/\/upload\.wikimedia\.org\/[^'")\s]+)/g;
const allUrls = [...new Set([...html.matchAll(regex)].map(m => m[1]))];
console.log(`Found ${allUrls.length} unique Wikimedia URLs\n`);

function testUrl(url) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://JoeLiang2022.github.io/',
      },
      timeout: 15000
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 200) {
        // Download the full image
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const mime = res.headers['content-type'] || 'image/jpeg';
          resolve({ url, status: 200, ok: true, buf, mime });
        });
      } else if (res.statusCode === 301 || res.statusCode === 302) {
        res.destroy();
        resolve({ url, status: res.statusCode, ok: false, redirect: res.headers.location });
      } else {
        res.destroy();
        resolve({ url, status: res.statusCode, ok: false });
      }
    }).on('error', (e) => {
      resolve({ url, status: 'ERR', ok: false, error: e.message });
    }).on('timeout', () => {
      resolve({ url, status: 'TIMEOUT', ok: false });
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const broken = [];
  const working = [];
  
  for (const url of allUrls) {
    await delay(2000); // Be nice to Wikimedia
    const result = await testUrl(url);
    const fname = url.split('/').pop();
    if (result.ok) {
      console.log(`✅ [${result.status}] ${fname} (${(result.buf.length/1024).toFixed(0)}KB)`);
      working.push(result);
    } else {
      console.log(`❌ [${result.status}] ${fname}`);
      broken.push(result);
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Working: ${working.length}, Broken: ${broken.length}`);
  
  if (broken.length > 0) {
    console.log(`\nBroken URLs:`);
    for (const b of broken) {
      console.log(`  ${b.url.split('/').pop()} → ${b.status}`);
    }
  }
  
  // Embed ALL images as base64 to avoid any future issues
  console.log(`\nEmbedding ALL ${working.length} working images as base64...`);
  for (const w of working) {
    const b64 = `data:${w.mime};base64,${w.buf.toString('base64')}`;
    html = html.split(w.url).join(b64);
    console.log(`  Embedded: ${w.url.split('/').pop()}`);
  }
  
  fs.writeFileSync('public/fukuoka.html', html, 'utf8');
  const size = fs.statSync('public/fukuoka.html').size;
  console.log(`\nHTML size: ${(size/1024).toFixed(0)}KB`);
  console.log(`Still broken (need manual fix): ${broken.length}`);
  for (const b of broken) {
    console.log(`  ${b.url.split('/').pop()}`);
  }
})();
