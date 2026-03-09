const fs = require('fs');
const https = require('https');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'public', 'img-cache');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const REMAINING = [
  { cache: '960px-Fukuoka_Tower.JPG', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Fukuoka_Tower.JPG/400px-Fukuoka_Tower.JPG' },
  { cache: '960px-Motsunabe_002.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Motsunabe_002.jpg/400px-Motsunabe_002.jpg' },
  { cache: '960px-Hakata_Station.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Hakata_Station.jpg/400px-Hakata_Station.jpg' },
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
  const toDownload = REMAINING.filter(r => !fs.existsSync(path.join(CACHE_DIR, r.cache)));
  console.log(`Need to download: ${toDownload.length} images`);
  
  if (toDownload.length === 0) {
    console.log('All images already cached!');
  } else {
    for (let i = 0; i < toDownload.length; i++) {
      const { cache, url } = toDownload[i];
      try {
        if (i > 0) {
          console.log('  Waiting 30s...');
          await sleep(30000);
        }
        console.log(`[${i+1}/${toDownload.length}] ${cache}`);
        const buf = await fetchBuffer(url);
        fs.writeFileSync(path.join(CACHE_DIR, cache), buf);
        console.log(`  ✅ ${(buf.length/1024).toFixed(0)} KB`);
      } catch(e) {
        console.error(`  ❌ ${e.message}`);
      }
    }
  }

  // Now rebuild embedded HTML
  console.log('\nRebuilding fukuoka-embedded.html...');
  const INPUT = path.join(__dirname, '..', 'public', 'fukuoka.html');
  const OUTPUT = path.join(__dirname, '..', 'public', 'fukuoka-embedded.html');
  let html = fs.readFileSync(INPUT, 'utf8');
  
  const imgRegex = /<img[^>]+src="(https:\/\/upload\.wikimedia\.org\/[^"]+)"/g;
  const matches = [...html.matchAll(imgRegex)];
  const cacheFiles = fs.readdirSync(CACHE_DIR);
  let ok = 0, ext = 0;
  
  for (const m of matches) {
    const url = m[1];
    const fname = decodeURIComponent(url.split('/').pop());
    const cacheFile = cacheFiles.find(f => f === fname);
    if (cacheFile) {
      const buf = fs.readFileSync(path.join(CACHE_DIR, cacheFile));
      const mimeExt = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      html = html.replace(url, `data:image/${mimeExt};base64,${buf.toString('base64')}`);
      ok++;
    } else {
      console.log(`  ⚠️ Missing: ${fname}`);
      ext++;
    }
  }
  
  html = html.replace(/<a href="https:\/\/commons\.wikimedia\.org\/[^"]*"[^>]*>\s*(<img[^>]+>)\s*<\/a>/g, '$1');
  fs.writeFileSync(OUTPUT, html, 'utf8');
  const size = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Done! ${ok} embedded, ${ext} external`);
  console.log(`Size: ${size} MB`);
}

main().catch(e => { console.error(e); process.exit(1); });
