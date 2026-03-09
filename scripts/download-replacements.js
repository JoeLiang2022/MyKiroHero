const https = require('https');
const fs = require('fs');
const path = require('path');

const imgDir = path.join('public', 'images');
if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

// Replacement images to download
const replacements = [
  {
    name: 'Kinrinko_Panoramic2.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Kinrinko_Panoramic2.jpg/1280px-Kinrinko_Panoramic2.jpg',
    fallback: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Kinrinko_Panoramic2.jpg'
  },
  {
    name: 'Dazaifu_Tenmangu_05.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Dazaifu_Tenmangu_05.jpg/1280px-Dazaifu_Tenmangu_05.jpg',
    fallback: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Dazaifu_Tenmangu_05.jpg'
  },
  {
    name: 'Canal_City_Hakata.jpg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Canal_City_Fukuoka_Washington_Hotel_2-20_Sumiyoshi_1-ch%C5%8Dme_Hakata-ku_Fukuoka_20240520.jpg/1280px-Canal_City_Fukuoka_Washington_Hotel_2-20_Sumiyoshi_1-ch%C5%8Dme_Hakata-ku_Fukuoka_20240520.jpg',
    fallback: 'https://upload.wikimedia.org/wikipedia/commons/4/4e/Canal_City_Fukuoka_Washington_Hotel_2-20_Sumiyoshi_1-ch%C5%8Dme_Hakata-ku_Fukuoka_20240520.jpg'
  }
];

function download(url, filepath) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*;q=0.8',
        'Referer': 'https://commons.wikimedia.org/'
      },
      timeout: 30000
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, filepath).then(resolve).catch(reject);
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
  for (const img of replacements) {
    const filepath = path.join(imgDir, img.name);
    try {
      await delay(3000);
      const size = await download(img.url, filepath);
      console.log(`✅ ${img.name} (${(size/1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`  ⚠️ Primary failed (${e.message}), trying fallback...`);
      try {
        await delay(3000);
        const size = await download(img.fallback, filepath);
        console.log(`✅ ${img.name} via fallback (${(size/1024).toFixed(0)}KB)`);
      } catch (e2) {
        console.log(`❌ ${img.name}: ${e2.message}`);
      }
    }
  }
  console.log('\nDone!');
  
  // List what we have
  const files = fs.readdirSync(imgDir);
  console.log(`\nImages in ${imgDir}:`);
  for (const f of files) {
    const size = fs.statSync(path.join(imgDir, f)).size;
    console.log(`  ${f} (${(size/1024).toFixed(0)}KB)`);
  }
})();
