const https = require('https');
const fs = require('fs');

const html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Find all wikimedia URLs
const allUrls = [];
const regex = /(https:\/\/upload\.wikimedia\.org\/[^'")\s]+)/g;
let m;
while ((m = regex.exec(html)) !== null) allUrls.push(m[1]);

const unique = [...new Set(allUrls)];
console.log(`Found ${unique.length} unique Wikimedia URLs to embed\n`);

function downloadAsBase64(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 30000
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadAsBase64(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/jpeg';
        const b64 = `data:${mime};base64,${buf.toString('base64')}`;
        console.log(`✅ ${url.split('/').pop()} (${(buf.length/1024).toFixed(0)}KB)`);
        resolve({ url, b64 });
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// Add delay between requests to avoid rate limiting
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let result = html;
  let success = 0, fail = 0;
  
  for (const url of unique) {
    try {
      await delay(1500); // 1.5s between requests
      const { b64 } = await downloadAsBase64(url);
      result = result.split(url).join(b64);
      success++;
    } catch (e) {
      console.log(`❌ ${url.split('/').pop()}: ${e.message}`);
      fail++;
    }
  }
  
  fs.writeFileSync('public/fukuoka.html', result, 'utf8');
  console.log(`\nDone! Embedded ${success}, failed ${fail}`);
  console.log(`File size: ${(fs.statSync('public/fukuoka.html').size/1024).toFixed(0)}KB`);
})();
