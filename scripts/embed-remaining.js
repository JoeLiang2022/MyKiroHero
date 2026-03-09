const fs = require('fs');
const https = require('https');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'public', 'img-cache');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Missing images - use 400px thumbs (smaller = less likely to be rate limited)
const MISSING = [
  { file: '800px-Motsunabe.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Motsunabe.jpg/400px-Motsunabe.jpg', cache: '800px-Motsunabe.jpg' },
  { file: '960px-Kushidajinjafukuoka01.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Kushidajinjafukuoka01.jpg/400px-Kushidajinjafukuoka01.jpg', cache: '960px-Kushidajinjafukuoka01.jpg' },
  { file: '960px-Canal_City_Hakata_2011.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Canal_City_Hakata_2011.jpg/400px-Canal_City_Hakata_2011.jpg', cache: '960px-Canal_City_Hakata_2011.jpg' },
  { file: 'Fukuoka-tenjin.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/2/2e/Fukuoka-tenjin.jpg', cache: 'Fukuoka-tenjin.jpg' },
  { file: '960px-20100720_Fukuoka_3697.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/20100720_Fukuoka_3697.jpg/400px-20100720_Fukuoka_3697.jpg', cache: '960px-20100720_Fukuoka_3697.jpg' },
  { file: '960px-Fukuoka_Tower.JPG', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fukuoka_Tower.JPG/400px-Fukuoka_Tower.JPG', cache: '960px-Fukuoka_Tower.JPG' },
  { file: '960px-Motsunabe_002.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Motsunabe_002.jpg/400px-Motsunabe_002.jpg', cache: '960px-Motsunabe_002.jpg' },
  { file: '960px-Hakata_Station.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Hakata_Station.jpg/400px-Hakata_Station.jpg', cache: '960px-Hakata_Station.jpg' },
];

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const get = (u, redir = 0) => {
      if (redir > 8) return reject(new Error('Too many redirects'));
      const opts = new URL(u);
      https.get({
        hostname: opts.hostname,
        path: opts.pathname + opts.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*,*/*;q=0.8',
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
  console.log(`Downloading ${MISSING.length} remaining images with 60s gaps...`);
  console.log(`Waiting 60s first to let rate limit cool down...\n`);
  await sleep(60000);

  for (let i = 0; i < MISSING.length; i++) {
    const { url, cache } = MISSING[i];
    const cachePath = path.join(CACHE_DIR, cache);
    
    if (fs.existsSync(cachePath)) {
      console.log(`[${i+1}/${MISSING.length}] ${cache} — already cached, skip`);
      continue;
    }
    
    try {
      console.log(`[${i+1}/${MISSING.length}] ${cache}`);
      const buf = await fetchBuffer(url);
      fs.writeFileSync(cachePath, buf);
      console.log(`  ✅ ${(buf.length / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
    }
    
    if (i < MISSING.length - 1) {
      console.log(`  ⏳ Waiting 60s...`);
      await sleep(60000);
    }
  }
  
  // Now rebuild the embedded HTML
  console.log(`\nRebuilding embedded HTML...`);
  const INPUT = path.join(__dirname, '..', 'public', 'fukuoka.html');
  const OUTPUT = path.join(__dirname, '..', 'public', 'fukuoka-embedded.html');
  let html = fs.readFileSync(INPUT, 'utf8');
  
  const imgRegex = /<img[^>]+src="(https:\/\/upload\.wikimedia\.org\/[^"]+)"/g;
  const matches = [...html.matchAll(imgRegex)];
  let ok = 0, fail = 0;
  
  for (const m of matches) {
    const url = m[1];
    const fname = decodeURIComponent(url.split('/').pop());
    // Try to find in cache by matching the filename pattern
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    const cacheFile = cacheFiles.find(f => f.includes(fname.replace(/[^a-zA-Z0-9._-]/g, '_')) || f === fname);
    
    if (cacheFile) {
      const buf = fs.readFileSync(path.join(CACHE_DIR, cacheFile));
      const ext = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      html = html.replace(url, `data:image/${ext};base64,${buf.toString('base64')}`);
      ok++;
    } else {
      console.log(`  ⚠️ No cache for: ${fname}`);
      fail++;
    }
  }
  
  html = html.replace(/<a href="https:\/\/commons\.wikimedia\.org\/[^"]*"[^>]*>\s*(<img[^>]+>)\s*<\/a>/g, '$1');
  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log(`\n✅ Done! ${ok} embedded, ${fail} still external`);
  console.log(`Size: ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
