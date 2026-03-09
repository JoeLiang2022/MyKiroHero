const fs = require('fs');
let html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Extract all base64 data URIs with their positions
const b64s = [];
const re = /data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g;
let m;
while ((m = re.exec(html)) !== null) {
  b64s.push({ start: m.index, data: m[0], len: m[0].length });
}
console.log(`Found ${b64s.length} base64 images`);

const broken = [
  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Dazaifu_Tenmangu_05.jpg/960px-Dazaifu_Tenmangu_05.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Canal_City_Hakata_2011.jpg/960px-Canal_City_Hakata_2011.jpg'
];

for (const url of broken) {
  const idx = html.indexOf(url);
  if (idx === -1) { console.log(`Not found: ${url.split('/').pop()}`); continue; }
  
  // Find the closest base64 BEFORE this position (the hero bg of the same section)
  let best = null;
  for (const b of b64s) {
    if (b.start < idx && (!best || b.start > best.start)) {
      best = b;
    }
  }
  
  if (best) {
    const dist = idx - best.start;
    console.log(`${url.split('/').pop()}: nearest base64 is ${dist} chars before (${(best.len/1024).toFixed(0)}KB)`);
    html = html.replace(url, best.data);
    console.log(`  Replaced!`);
  } else {
    console.log(`No base64 found before ${url.split('/').pop()}`);
  }
}

fs.writeFileSync('public/fukuoka.html', html, 'utf8');
const size = fs.statSync('public/fukuoka.html').size;
console.log(`\nFinal size: ${(size/1024).toFixed(0)}KB`);
const remaining = (html.match(/upload\.wikimedia\.org/g) || []).length;
console.log(`Remaining Wikimedia URLs: ${remaining}`);
