const fs = require('fs');
const https = require('https');

let html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Step 1: Wrap each <img> in <a> linking to full-res Unsplash image
// Pattern: <div class="sw"><img class="si" src="https://images.unsplash.com/photo-XXX?w=800&h=360&fit=crop" ...>
// Replace with: <div class="sw"><a href="https://images.unsplash.com/photo-XXX?w=1920&q=90" target="_blank"><img ...></a>
html = html.replace(
  /<img class="si" src="(https:\/\/images\.unsplash\.com\/(photo-[^?]+))\?w=800&h=360&fit=crop"([^>]*)>/g,
  '<a href="https://images.unsplash.com/$2?w=1920&q=90" target="_blank" style="display:block"><img class="si" src="$1?w=800&h=360&fit=crop"$3></a>'
);

console.log('Step 1: Added <a> links to all images');

// Step 2: Extract all image URLs for embedding
const regex = /src="(https:\/\/images\.unsplash\.com\/[^"]+)"/g;
const urls = [];
let m;
while ((m = regex.exec(html)) !== null) {
  urls.push(m[1]);
}
console.log('Found', urls.length, 'images to embed');

// Step 3: Download and embed
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const smallUrl = url.replace('w=800', 'w=400');
    const doGet = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doGet(res.headers.location);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    doGet(smallUrl);
  });
}

async function main() {
  let result = html;
  for (let i = 0; i < urls.length; i++) {
    try {
      const buf = await downloadImage(urls[i]);
      const b64 = 'data:image/jpeg;base64,' + buf.toString('base64');
      result = result.replace(urls[i], b64);
      console.log('[' + (i + 1) + '] OK: ' + Math.round(buf.length / 1024) + 'KB');
    } catch (e) {
      console.log('[' + (i + 1) + '] FAILED: ' + e.message);
    }
  }

  // Verify <a href> links are NOT replaced (they should still point to Unsplash)
  const aHrefCount = (result.match(/href="https:\/\/images\.unsplash\.com/g) || []).length;
  const imgSrcUnsplash = (result.match(/src="https:\/\/images\.unsplash\.com/g) || []).length;
  const b64Count = (result.match(/data:image\/jpeg;base64,/g) || []).length;

  fs.writeFileSync('public/fukuoka-embedded.html', result, 'utf8');
  const stat = fs.statSync('public/fukuoka-embedded.html');

  console.log('\n=== Result ===');
  console.log('File size:', Math.round(stat.size / 1024) + 'KB');
  console.log('Chinese OK:', result.includes('福岡'));
  console.log('Base64 embedded images:', b64Count);
  console.log('Clickable <a> links to full-res:', aHrefCount);
  console.log('Remaining Unsplash src URLs:', imgSrcUnsplash);
}

main().catch(console.error);
