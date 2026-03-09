const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'public', 'fukuoka.html');
const OUTPUT = path.join(__dirname, '..', 'public', 'fukuoka-embedded.html');
const CACHE_DIR = path.join(__dirname, '..', 'public', 'img-cache');

let html = fs.readFileSync(INPUT, 'utf8');
const imgRegex = /<img[^>]+src="(https:\/\/upload\.wikimedia\.org\/[^"]+)"/g;
const matches = [...html.matchAll(imgRegex)];
const cacheFiles = fs.readdirSync(CACHE_DIR);

let ok = 0, ext = 0;
for (const m of matches) {
  const url = m[1];
  const fname = decodeURIComponent(url.split('/').pop());
  const cacheFile = cacheFiles.find(f => f === fname || f === fname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  
  if (cacheFile) {
    const buf = fs.readFileSync(path.join(CACHE_DIR, cacheFile));
    const mimeExt = fname.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    html = html.replace(url, `data:image/${mimeExt};base64,${buf.toString('base64')}`);
    console.log(`✅ ${fname} (${(buf.length/1024).toFixed(0)} KB)`);
    ok++;
  } else {
    console.log(`🔗 ${fname} (external)`);
    ext++;
  }
}

// Remove <a> wrappers
html = html.replace(/<a href="https:\/\/commons\.wikimedia\.org\/[^"]*"[^>]*>\s*(<img[^>]+>)\s*<\/a>/g, '$1');

fs.writeFileSync(OUTPUT, html, 'utf8');
console.log(`\nDone: ${ok} embedded, ${ext} external`);
console.log(`Size: ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(2)} MB`);
