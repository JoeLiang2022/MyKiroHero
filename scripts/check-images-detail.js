const fs = require('fs');
const html = fs.readFileSync('public/fukuoka.html', 'utf8');

// Find all img tags with their surrounding context
const imgRegex = /<img[^>]+>/g;
let match;
let i = 0;
while ((match = imgRegex.exec(html)) !== null) {
  i++;
  const pos = match.index;
  // Get 200 chars before the img tag for context
  const before = html.substring(Math.max(0, pos - 300), pos);
  const srcMatch = match[0].match(/src="([^"]{0,80})/);
  const altMatch = match[0].match(/alt="([^"]+)"/);
  const src = srcMatch ? srcMatch[1] : 'no src';
  const alt = altMatch ? altMatch[1] : 'no alt';
  
  // Find caption/label near the image
  const afterText = html.substring(pos, pos + 500);
  const captionMatch = afterText.match(/📷[^<]*/);
  
  console.log(`\n--- Image ${i} ---`);
  console.log(`Alt: ${alt}`);
  console.log(`Caption: ${captionMatch ? captionMatch[0] : 'none'}`);
  console.log(`Src type: ${src.startsWith('data:image') ? 'base64 (' + Math.round(match[0].length/1024) + 'KB)' : src}`);
  
  // Check context before for section identification
  const sectionMatch = before.match(/DAY \d[^<]*/g);
  const headingMatch = before.match(/[🏞️⛩️🍲🏙️🍜♨️🛶🍗🛍️🏖️🍣🌳☕🏛️]/g);
  if (sectionMatch) console.log(`Section: ${sectionMatch[sectionMatch.length-1]}`);
}
