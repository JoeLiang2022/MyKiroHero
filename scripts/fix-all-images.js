const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const imgDir = path.join('public', 'images');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

const downloads = [
  { name: 'Kinrinko_Panoramic2.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Kinrinko_Panoramic2.jpg' },
  { name: 'Dazaifu_Tenmangu_05.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/5/5a/Dazaifu_Tenmangu_05.jpg' },
  { name: 'Canal_City_Hakata_2011.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/Canal_City_Hakata_2011.jpg' },
];

for (const img of downloads) {
  const filepath = path.join(imgDir, img.name);
  try {
    // Use PowerShell Invoke-WebRequest with proper User-Agent
    const cmd = `powershell -Command "Invoke-WebRequest -Uri '${img.url}' -OutFile '${filepath}' -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' -UseBasicParsing"`;
    execSync(cmd, { timeout: 30000 });
    const size = fs.statSync(filepath).size;
    console.log(`✅ ${img.name} (${(size/1024).toFixed(0)}KB)`);
  } catch(e) {
    console.log(`❌ ${img.name}: ${e.message.split('\n')[0]}`);
  }
}

// List all images
console.log('\nAll images in public/images/:');
for (const f of fs.readdirSync(imgDir)) {
  if (f.endsWith('.json')) continue;
  const s = fs.statSync(path.join(imgDir, f)).size;
  console.log(`  ${f} (${(s/1024).toFixed(0)}KB)`);
}
