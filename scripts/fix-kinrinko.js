const https = require('https');
const fs = require('fs');

// Use Wikimedia API to find a good Kinrin Lake image
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'FukuokaTrip/1.0 (travel page)' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  // Search for Kinrin Lake images via Wikimedia API
  const searchUrl = 'https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=Kinrin+Lake+Yufuin&srnamespace=6&srlimit=10&format=json';
  console.log('Searching Wikimedia for Kinrin Lake...');
  const searchRes = await fetchUrl(searchUrl);
  const searchData = JSON.parse(searchRes.data.toString());
  
  console.log('Results:');
  for (const r of searchData.query.search) {
    console.log(`  ${r.title}`);
  }

  // Get image info for the best candidates
  const candidates = searchData.query.search.map(r => r.title).slice(0, 5);
  
  for (const title of candidates) {
    const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=960&format=json`;
    const infoRes = await fetchUrl(infoUrl);
    const infoData = JSON.parse(infoRes.data.toString());
    const pages = infoData.query.pages;
    const page = Object.values(pages)[0];
    if (page.imageinfo) {
      const ii = page.imageinfo[0];
      console.log(`\n${title}:`);
      console.log(`  Original: ${ii.width}x${ii.height}, ${ii.mime}`);
      console.log(`  Thumb URL: ${ii.thumburl}`);
      console.log(`  Thumb size: ${ii.thumbwidth}x${ii.thumbheight}`);
    }
  }

  // Try to download the first good one - Kinrinko_Panoramic2.jpg was used before
  const targetTitle = 'File:Kinrinko_Panoramic2.jpg';
  console.log(`\nTrying to download: ${targetTitle}`);
  const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(targetTitle)}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=960&format=json`;
  const infoRes = await fetchUrl(infoUrl);
  const infoData = JSON.parse(infoRes.data.toString());
  const pages = infoData.query.pages;
  const page = Object.values(pages)[0];
  
  if (page.imageinfo) {
    const thumbUrl = page.imageinfo[0].thumburl;
    console.log(`Downloading: ${thumbUrl}`);
    const imgRes = await fetchUrl(thumbUrl);
    console.log(`Status: ${imgRes.status}, Size: ${imgRes.data.length} bytes`);
    
    if (imgRes.status === 200 && imgRes.data.length > 1000) {
      const b64 = imgRes.data.toString('base64');
      console.log(`Base64 length: ${b64.length}`);
      
      // Now replace in HTML
      const html = fs.readFileSync('public/fukuoka.html', 'utf8');
      
      // Find the 金鱗湖 img tag and replace its src
      const kinrinRegex = /(alt="金鱗湖"[^>]*src=")data:image\/jpeg;base64,[^"]+(")/;
      if (kinrinRegex.test(html)) {
        const newHtml = html.replace(kinrinRegex, `$1data:image/jpeg;base64,${b64}$2`);
        fs.writeFileSync('public/fukuoka.html', newHtml);
        console.log('Replaced 金鱗湖 image in fukuoka.html!');
        console.log(`New file size: ${Math.round(newHtml.length/1024)}KB`);
      } else {
        // Try other pattern - src before alt
        const kinrinRegex2 = /(src=")data:image\/jpeg;base64,[^"]+("[^>]*alt="金鱗湖")/;
        if (kinrinRegex2.test(html)) {
          const newHtml = html.replace(kinrinRegex2, `$1data:image/jpeg;base64,${b64}$2`);
          fs.writeFileSync('public/fukuoka.html', newHtml);
          console.log('Replaced 金鱗湖 image (pattern 2)!');
          console.log(`New file size: ${Math.round(newHtml.length/1024)}KB`);
        } else {
          console.log('Could not find 金鱗湖 img pattern in HTML');
        }
      }
    } else {
      console.log('Download failed or too small');
    }
  }
}

main().catch(e => console.error(e));
