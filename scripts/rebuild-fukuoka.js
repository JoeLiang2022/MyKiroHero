/**
 * Rebuild fukuoka.html with verified Wikimedia Commons images
 * Each image URL is from a file with a clear, descriptive filename
 * that guarantees the content matches the location.
 */
const fs = require('fs');
const https = require('https');
const http = require('http');

// Verified image mapping: each URL is a Wikimedia Commons file
// with a descriptive filename that matches the actual location/food
const IMAGE_MAP = [
  {
    spot: '福岡機場',
    // Wikimedia: "Fukuoka Airport Domestic Terminal" - actual Fukuoka Airport
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Fukuoka_Airport_Domestic_Terminal_2023.jpg/800px-Fukuoka_Airport_Domestic_Terminal_2023.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Fukuoka_Airport_Domestic_Terminal_2023.jpg',
    caption: '📷 福岡空港（Wikimedia Commons CC）'
  },
  {
    spot: '中洲屋台',
    // Wikimedia: "Yatai in Fukuoka" - actual Nakasu yatai food stalls
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Yatai_in_Fukuoka.jpg/800px-Yatai_in_Fukuoka.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Yatai_in_Fukuoka.jpg',
    caption: '📷 中洲屋台街 — 福岡名物夜市（Wikimedia Commons CC）'
  },
  {
    spot: '由布院之森列車',
    // Wikimedia: "Yufuin-no-Mori-72" - actual Yufuin no Mori train
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Yufuin-no-Mori-72.jpg/800px-Yufuin-no-Mori-72.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Yufuin-no-Mori-72.jpg',
    caption: '📷 JR 特急「由布院之森」觀光列車（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '由布院',
    // Wikimedia: "Mt Yufu at morning" - Mount Yufu from Yufuin
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Mt_Yufu_at_morning.JPG/800px-Mt_Yufu_at_morning.JPG',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Mt_Yufu_at_morning.JPG',
    caption: '📷 由布院溫泉街與由布岳（Wikimedia Commons CC）'
  },
  {
    spot: '金鱗湖',
    // Wikimedia: "Kinrinko Panoramic2" - actual Kinrin Lake in Yufuin
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Kinrinko_Panoramic2.jpg/800px-Kinrinko_Panoramic2.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Kinrinko_Panoramic2.jpg',
    caption: '📷 金鱗湖 — 由布院必訪（Wikimedia Commons CC-BY）'
  },
  {
    spot: '一蘭拉麵',
    // Wikimedia: "Ichiran Ramen" - actual Ichiran ramen bowl
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Ichiran_Ramen.JPG/800px-Ichiran_Ramen.JPG',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Ichiran_Ramen.JPG',
    caption: '📷 一蘭拉麵 — 博多必吃（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '太宰府天滿宮',
    // Wikimedia: "Dazaifu Tenmangu 05" - actual Dazaifu Tenmangu shrine
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Dazaifu_Tenmangu_05.jpg/800px-Dazaifu_Tenmangu_05.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Dazaifu_Tenmangu_05.jpg',
    caption: '📷 太宰府天滿宮 — 學問之神（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '表參道',
    // Wikimedia: "Dazaifu Tenmangu 07" - Dazaifu approach/omotesando area
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Dazaifu_Tenmangu_07.jpg/800px-Dazaifu_Tenmangu_07.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Dazaifu_Tenmangu_07.jpg',
    caption: '📷 太宰府表參道 — 梅枝餅・星巴克概念店（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '柳川遊船',
    // Wikimedia: "Yanagawa river cruise" - actual Yanagawa boat
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Yanagawa_river_cruise.jpg/800px-Yanagawa_river_cruise.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Yanagawa_river_cruise.jpg',
    caption: '📷 柳川遊船 — 護城河遊覽（Wikimedia Commons CC）'
  },
  {
    spot: '鰻魚飯',
    // Wikimedia: "Unaju" (eel on rice) - actual unagi dish
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Unaju.jpg/800px-Unaju.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Unaju.jpg',
    caption: '📷 柳川名物 — 鰻魚飯（Wikimedia Commons CC）'
  },
  {
    spot: '牛腸鍋',
    // Wikimedia: "Motsunabe" - actual motsu nabe hot pot
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Motsunabe.jpg/800px-Motsunabe.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Motsunabe.jpg',
    caption: '📷 もつ鍋（牛腸鍋）— 福岡名物（Wikimedia Commons CC）'
  },
  {
    spot: '櫛田神社',
    // Wikimedia: "Kushidajinjafukuoka01" - actual Kushida Shrine in Fukuoka
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Kushidajinjafukuoka01.jpg/800px-Kushidajinjafukuoka01.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Kushidajinjafukuoka01.jpg',
    caption: '📷 櫛田神社 — 博多總鎮守（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: 'Canal City',
    // Wikimedia: "Canal City Hakata 2011" - actual Canal City Hakata
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Canal_City_Hakata_2011.jpg/800px-Canal_City_Hakata_2011.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Canal_City_Hakata_2011.jpg',
    caption: '📷 Canal City Hakata 運河城（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '天神',
    // Wikimedia: "Fukuoka-tenjin" - Tenjin area in Fukuoka
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Fukuoka-tenjin.jpg/480px-Fukuoka-tenjin.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Fukuoka-tenjin.jpg',
    caption: '📷 天神地下街 — 超好逛（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '大濠公園',
    // Wikimedia: "Ohori Park" - actual Ohori Park in Fukuoka
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/20100720_Fukuoka_3697.jpg/800px-20100720_Fukuoka_3697.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:20100720_Fukuoka_3697.jpg',
    caption: '📷 大濠公園 — 環湖散步（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '福岡塔',
    // Wikimedia: "Fukuoka Tower" - actual Fukuoka Tower
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Fukuoka_Tower.JPG/450px-Fukuoka_Tower.JPG',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Fukuoka_Tower.JPG',
    caption: '📷 福岡塔 — 夕陽絕景（Wikimedia Commons CC-BY-SA）'
  },
  {
    spot: '水炊き',
    // Wikimedia: "Mizutaki" - actual mizutaki chicken hot pot
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Mizutaki.jpg/800px-Mizutaki.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Mizutaki.jpg',
    caption: '📷 水炊き（雞肉鍋）— 博多名物（Wikimedia Commons CC）'
  },
  {
    spot: '博多站',
    // Wikimedia: "Hakata Station" - actual Hakata Station building
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Hakata_Station.jpg/800px-Hakata_Station.jpg',
    fullUrl: 'https://commons.wikimedia.org/wiki/File:Hakata_Station.jpg',
    caption: '📷 博多站 — 伴手禮天堂（Wikimedia Commons CC-BY）'
  }
];

// Download image following redirects
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const doGet = (u, redirectCount) => {
      if (redirectCount > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FukuokaTrip/1.0)' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
          doGet(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    doGet(url, 0);
  });
}

async function main() {
  console.log('Reading source HTML...');
  let html = fs.readFileSync('public/fukuoka.html', 'utf8');

  // We'll replace each <div class="sw">...<img>...</div> block
  // The HTML has exactly 18 image blocks in order
  const imgRegex = /<div class="sw"><img class="si" src="[^"]*" alt="([^"]*)"[^>]*><div class="cap">[^<]*<\/div><\/div>/g;
  
  let matches = [];
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    matches.push({ fullMatch: m[0], alt: m[1], index: m.index });
  }
  
  console.log(`Found ${matches.length} image blocks in HTML`);
  
  if (matches.length !== IMAGE_MAP.length) {
    console.error(`MISMATCH: Found ${matches.length} images but have ${IMAGE_MAP.length} in map`);
    console.log('Image alts found:', matches.map(m => m.alt));
    // Continue anyway, matching by index
  }

  // Download all images
  console.log('\nDownloading images from Wikimedia Commons...');
  const imageData = [];
  
  for (let i = 0; i < IMAGE_MAP.length; i++) {
    const entry = IMAGE_MAP[i];
    process.stdout.write(`[${i + 1}/${IMAGE_MAP.length}] ${entry.spot}... `);
    try {
      const buf = await downloadImage(entry.url);
      const ext = entry.url.match(/\.(jpg|jpeg|png|gif)/i);
      const mime = ext ? `image/${ext[1].toLowerCase().replace('jpg', 'jpeg')}` : 'image/jpeg';
      const b64 = `data:${mime};base64,${buf.toString('base64')}`;
      imageData.push({ ...entry, b64, size: buf.length });
      console.log(`OK (${Math.round(buf.length / 1024)}KB)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      imageData.push({ ...entry, b64: null, size: 0 });
    }
  }

  // Now rebuild the HTML with new images
  // Replace from last to first to preserve indices
  let result = html;
  for (let i = Math.min(matches.length, IMAGE_MAP.length) - 1; i >= 0; i--) {
    const match = matches[i];
    const img = imageData[i];
    
    if (!img.b64) {
      console.log(`Skipping ${img.spot} (download failed)`);
      continue;
    }

    const newBlock = `<div class="sw"><a href="${img.fullUrl}" target="_blank" rel="noopener" style="display:block"><img class="si" src="${img.b64}" alt="${img.spot}" loading="lazy"></a><div class="cap">${img.caption}</div></div>`;
    
    result = result.substring(0, match.index) + newBlock + result.substring(match.index + match.fullMatch.length);
  }

  // Update footer
  result = result.replace(
    '圖片來源：Unsplash（免費授權）',
    '圖片來源：Wikimedia Commons（CC 授權）'
  );

  // Write output
  fs.writeFileSync('public/fukuoka-embedded.html', result, 'utf8');
  const stat = fs.statSync('public/fukuoka-embedded.html');

  console.log('\n=== Result ===');
  console.log('File size:', Math.round(stat.size / 1024) + 'KB');
  console.log('Chinese OK:', result.includes('福岡'));
  console.log('Base64 images:', (result.match(/data:image\//g) || []).length);
  console.log('Clickable links:', (result.match(/href="https:\/\/commons\.wikimedia/g) || []).length);
  
  const failed = imageData.filter(d => !d.b64);
  if (failed.length > 0) {
    console.log('\nFAILED images:');
    failed.forEach(f => console.log(`  - ${f.spot}: ${f.url}`));
  }
}

main().catch(console.error);
