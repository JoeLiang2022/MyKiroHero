const fs = require('fs');
const https = require('https');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'public', 'fukuoka.html');
const OUTPUT = path.join(__dirname, '..', 'public', 'fukuoka-embedded.html');
const CACHE_DIR = path.join(__dirname, '..', 'public', 'img-cache');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function fetchBuffer(url, retries = 8) {
  return new Promise((resolve, reject) => {
    const get = (u, redir = 0) => {
      if (redir > 8) return reject(new Error('Too many redirects'));
      const opts = new URL(u);
      https.get({
        hostname: opts.hostname,
        path: opts.pathname + opts.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://commons.wikimedia.org/',
          'Connection': 'close'
        }
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let loc = res.headers.location;
          if (loc.startsWith('/')) loc = `https://${opts.hostname}${loc}`;
          res.resume();
          return get(loc, redir + 1);
        }
        if (res.statusCode === 429 && retries > 0) {
          const wait = 15000 + Math.random() * 10000;
          console.log(`    ⏳ 429, wait ${(wait/1000).toFixed(0)}s (${retries} left)`);
          res.resume();
          return sleep(wait).then(() => fetchBuffer(url, retries - 1)).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

async function main() {
  let html = fs.readFileSync(INPUT, 'utf8');
  const imgRegex = /<img[^>]+src="(https:\/\/upload\.wikimedia\.org\/[^"]+)"/g;
  const matches = [...html.matchAll(imgRegex)];
  console.log(`Found ${matches.length} images to embed`);

  let ok = 0, fail = 0;
  for (let i = 0; i < matches.length; i++) {
    const url = matches[i][1];
    const fname = decodeURIComponent(url.split('/').pop());
    const cachePath = path.join(CACHE_DIR, fname.replace(/[^a-zA-Z0-9._-]/g, '_'));
    
    try {
      let buf;
      // Check cache first
      if (fs.existsSync(cachePath)) {
        buf = fs.readFileSync(cachePath);
        console.log(`[${i+1}/${matches.length}] ${fname} (cached ${(buf.length/1024).toFixed(0)} KB)`);
      } else {
        console.log(`[${i+1}/${matches.length}] ${fname}`);
        buf = await fetchBuffer(url);
        fs.writeFileSync(cachePath, buf);
        console.log(`  ✅ ${(buf.length / 1024).toFixed(0)} KB`);
        // Wait 5s between downloads to be gentle
        if (i < matches.length - 1) await sleep(5000);
      }
      
      const ext = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      const b64 = `data:image/${ext};base64,${buf.toString('base64')}`;
      html = html.replace(url, b64);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
      fail++;
    }
  }

  // Remove <a> wrappers around images
  html = html.replace(/<a href="https:\/\/commons\.wikimedia\.org\/[^"]*"[^>]*>\s*(<img[^>]+>)\s*<\/a>/g, '$1');

  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log(`\n✅ Done! ${ok} embedded, ${fail} failed`);
  console.log(`Output: ${OUTPUT}`);
  console.log(`Size: ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
