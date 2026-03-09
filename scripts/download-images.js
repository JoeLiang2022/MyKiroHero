const https = require('https');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Find all wikimedia URLs
const regex = /(https:\/\/upload\.wikimedia\.org\/[^'")\s]+)/g;
const allUrls = [];
let m;
while ((m = regex.exec(html)) !== null) allUrls.push(m[1]);
const unique = [...new Set(allUrls)];

// Deduplicate by base filename (same image, different sizes)
const byBase = {};
for (const url of unique) {
  const parts = url.split('/');
  let filename = parts[parts.length - 1].replace(/^\d+px-/, '');
  if (!byBase[filename]) byBase[filename] = [];
  byBase[filename].push(url);
}

console.log(`Found ${unique.length} URLs, ${Object.keys(byBase).length} unique images\n`);

const imgDir = path.join('public', 'images');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

function download(url, filepath, retries = 3) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://commons.wikimedia.org/'
      },
      timeout: 30000
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, filepath, retries).then(resolve).catch(reject);
      }
      if (res.statusCode === 429 && retries > 0) {
        res.destroy();
        const wait = 5000;
        console.log(`  ⏳ Rate limited, waiting ${wait/1000}s... (${retries} retries left)`);
        return setTimeout(() => download(url, filepath, retries - 1).then(resolve).catch(reject), wait);
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(filepath, buf);
        resolve(buf.length);
      });
    }).on('error', reject);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const mapping = {};
  let success = 0, fail = 0;

  for (const [filename, urls] of Object.entries(byBase)) {
    const filepath = path.join(imgDir, filename);
    
    // Download the largest version (usually the 1280px one)
    const bestUrl = urls.sort((a, b) => b.length - a.length)[0];
    
    try {
      await delay(3000);
      const size = await download(bestUrl, filepath);
      console.log(`✅ ${filename} (${(size/1024).toFixed(0)}KB)`);
      
      // Map ALL urls for this base image to the local file
      for (const url of urls) {
        mapping[url] = `images/${filename}`;
      }
      success++;
    } catch (e) {
      console.log(`❌ ${filename}: ${e.message}`);
      fail++;
    }
  }

  // Update HTML
  let result = html;
  for (const [url, local] of Object.entries(mapping)) {
    result = result.split(url).join(local);
  }
  fs.writeFileSync('public/fukuoka.html', result, 'utf8');
  
  console.log(`\n✅ Done! ${success} downloaded, ${fail} failed`);
  console.log(`HTML updated with local image paths`);
})();
