const https = require('https');

const files = [
  'File:Kinrinko_Panoramic2.jpg',
  'File:Dazaifu_Tenmangu_05.jpg',
  'File:Canal_City_Fukuoka_Washington_Hotel_2-20_Sumiyoshi_1-chōme_Hakata-ku_Fukuoka_20240520.jpg',
  'File:Dazaifu_shrine.jpg',
  'File:RZ_United_Cinema_Canal_City_13.jpg'
];

function apiQuery(titles) {
  const encoded = encodeURIComponent(titles);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encoded}&prop=imageinfo&iiprop=url|size&iiurlwidth=1280&format=json`;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'FukuokaTrip/1.0 (travel page image fix)' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  for (const file of files) {
    try {
      const result = await apiQuery(file);
      const pages = result.query.pages;
      for (const id of Object.keys(pages)) {
        const page = pages[id];
        if (page.imageinfo) {
          const info = page.imageinfo[0];
          console.log(`\n${file}:`);
          console.log(`  Original: ${info.url}`);
          console.log(`  Thumb: ${info.thumburl || 'N/A'}`);
          console.log(`  Size: ${info.width}x${info.height}`);
        } else {
          console.log(`\n${file}: NOT FOUND`);
        }
      }
    } catch(e) {
      console.log(`\n${file}: ERROR - ${e.message}`);
    }
  }
})();
