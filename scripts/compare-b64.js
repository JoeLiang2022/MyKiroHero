const fs = require('fs');
const html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Extract all base64 src values
const imgs = [];
const regex = /<img[^>]*alt="([^"]*)"[^>]*src="(data:image[^"]{0,50})/g;
let m;
while ((m = regex.exec(html)) !== null) {
  imgs.push({ alt: m[1], prefix: m[2] });
}

// Also try src before alt
const regex2 = /<img[^>]*src="(data:image\/[a-z]+;base64,([A-Za-z0-9+/=]{40}))[^"]*"[^>]*alt="([^"]*)"/g;
while ((m = regex2.exec(html)) !== null) {
  // Check if already found
  if (!imgs.find(i => i.alt === m[3])) {
    imgs.push({ alt: m[3], prefix: m[1].substring(0, 60) });
  }
}

console.log('Images found:');
imgs.forEach(i => console.log(`  ${i.alt}: ${i.prefix}...`));

// Check if kinrinko and motsunabe have same base64
const kinrinko = html.match(/alt="金鱗湖"[^>]*src="(data:image[^"]{0,200})/);
const motsunabe = html.match(/alt="牛腸鍋"[^>]*src="(data:image[^"]{0,200})/);

if (kinrinko && motsunabe) {
  console.log('\n金鱗湖 b64 start:', kinrinko[1].substring(0, 80));
  console.log('牛腸鍋 b64 start:', motsunabe[1].substring(0, 80));
  console.log('Same?', kinrinko[1].substring(0, 200) === motsunabe[1].substring(0, 200));
}
