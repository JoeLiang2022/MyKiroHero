const fs = require('fs');
const h = fs.readFileSync('public/fukuoka.html', 'utf8');
console.log('File size:', Math.round(h.length/1024) + 'KB');

// Extract first 60 chars of base64 for each image
const imgs = [
  { name: '金鱗湖', regex: /src="(data:image\/jpeg;base64,[A-Za-z0-9+\/=]{60})[^"]*"[^>]*alt="金鱗湖"/ },
  { name: '牛腸鍋', regex: /src="(data:image\/jpeg;base64,[A-Za-z0-9+\/=]{60})[^"]*"[^>]*alt="牛腸鍋"/ },
];

for (const img of imgs) {
  const m = h.match(img.regex);
  console.log(`${img.name}: ${m ? m[1].substring(0, 70) + '...' : 'NOT FOUND'}`);
}

// Check if they're different
const k = h.match(/src="data:image\/jpeg;base64,([A-Za-z0-9+\/=]{100})[^"]*"[^>]*alt="金鱗湖"/);
const m = h.match(/src="data:image\/jpeg;base64,([A-Za-z0-9+\/=]{100})[^"]*"[^>]*alt="牛腸鍋"/);
if (k && m) {
  console.log('Different images?', k[1] !== m[1]);
}
