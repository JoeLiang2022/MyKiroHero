const fs = require('fs');
let html = fs.readFileSync('public/fukuoka.html', 'utf8');

// The 3 remaining broken URLs are 960px versions of images we already have as 1280px base64
// Strategy: find the base64 data from the 1280px version and use it for 960px too

const pairs = [
  {
    broken: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Kinrinko_Panoramic2.jpg/960px-Kinrinko_Panoramic2.jpg',
    search: 'Kinrinko_Panoramic2'
  },
  {
    broken: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Dazaifu_Tenmangu_05.jpg/960px-Dazaifu_Tenmangu_05.jpg',
    search: 'Dazaifu_Tenmangu_05'
  },
  {
    broken: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Canal_City_Hakata_2011.jpg/960px-Canal_City_Hakata_2011.jpg',
    search: 'Canal_City_Hakata_2011'
  }
];

for (const pair of pairs) {
  if (!html.includes(pair.broken)) {
    console.log(`Already fixed: ${pair.search}`);
    continue;
  }
  
  // Find the base64 data URI that replaced the 1280px version
  const b64Match = html.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g);
  if (!b64Match) {
    console.log(`No base64 data found at all!`);
    continue;
  }
  
  // The 1280px version was already embedded. Find it by looking at what's near the hero bg
  // Actually, let's just use the first base64 image that's near the same section
  // Simpler: just replace the broken URL with the 1280px base64 that's already in the file
  
  // Find the 1280px URL pattern to locate its base64
  const pattern1280 = `1280px-${pair.search}`;
  
  // The 1280px was already replaced with base64. Find that base64 by looking for data:image right before
  // a known context string near where the 1280px was used
  
  // Actually the simplest approach: extract ANY base64 data URI from the file, 
  // they're all unique. Let me find the one used in the hero bg for this section.
  console.log(`Fixing ${pair.search}...`);
  
  // Count occurrences
  const count = html.split(pair.broken).length - 1;
  console.log(`  Found ${count} occurrences of broken URL`);
  
  // For each broken URL, replace with the 1280px embedded version
  // The 1280px is already embedded as base64 in the hero-bg style
  // Let's extract it
  const heroPattern = new RegExp(`background-image:url\\('(data:image/jpeg;base64,[^']+)'\\).*?${pair.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${pair.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?background-image:url\\('(data:image/jpeg;base64,[^']+)'\\)`);
  
  // Different approach: just find all data:image URIs and use the right one
  // Since the hero bg for each section uses the 1280px version (now base64),
  // I can extract it by finding the base64 near the section
}

// Simpler approach: just find and extract base64 data URIs
const b64Pattern = /data:image\/jpeg;base64,([A-Za-z0-9+/=]{1000,})/g;
const allB64 = [];
let match;
while ((match = b64Pattern.exec(html)) !== null) {
  allB64.push({ index: match.index, full: match[0], len: match[0].length });
}
console.log(`\nFound ${allB64.length} base64 images in HTML`);

// For each broken URL, find the nearest base64 in the same section and use it
for (const pair of pairs) {
  if (!html.includes(pair.broken)) continue;
  
  const brokenIdx = html.indexOf(pair.broken);
  // Find the nearest base64 before this position (should be the hero bg)
  let nearest = null;
  let minDist = Infinity;
  for (const b of allB64) {
    const dist = Math.abs(b.index - brokenIdx);
    if (dist < minDist && dist < 5000) { // within 5000 chars
      minDist = dist;
      nearest = b;
    }
  }
  
  if (nearest) {
    html = html.split(pair.broken).join(nearest.full);
    console.log(`Replaced ${pair.search} (960px) with nearby base64 (${(nearest.len/1024).toFixed(0)}KB)`);
  } else {
    console.log(`Could not find nearby base64 for ${pair.search}`);
  }
}

fs.writeFileSync('public/fukuoka.html', html, 'utf8');
const size = fs.statSync('public/fukuoka.html').size;
console.log(`\nFinal HTML size: ${(size/1024).toFixed(0)}KB`);

// Verify no more wikimedia URLs
const remaining = (html.match(/upload\.wikimedia\.org/g) || []).length;
console.log(`Remaining Wikimedia URLs: ${remaining}`);
