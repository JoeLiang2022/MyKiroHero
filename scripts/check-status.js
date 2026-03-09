const fs = require('fs');
const html = fs.readFileSync('public/fukuoka.html', 'utf8');
console.log('File size:', Math.round(html.length / 1024) + 'KB');

// Check for remaining wikimedia URLs
const wikiUrls = html.match(/https:\/\/upload\.wikimedia\.org[^"'>\s]+/g) || [];
console.log('Remaining Wikimedia URLs:', wikiUrls.length);
wikiUrls.forEach(u => console.log('  ', u.substring(0, 120)));

// Count base64 images
const b64count = (html.match(/data:image/g) || []).length;
console.log('Base64 embedded images:', b64count);

// Count all img tags
const imgTags = html.match(/<img[^>]+>/g) || [];
console.log('Total <img> tags:', imgTags.length);

// Check for any broken src
imgTags.forEach((tag, i) => {
  const src = tag.match(/src="([^"]+)"/);
  if (src) {
    const val = src[1];
    if (val.startsWith('data:image')) {
      console.log(`  img ${i+1}: base64 (${Math.round(val.length/1024)}KB)`);
    } else {
      console.log(`  img ${i+1}: URL - ${val.substring(0, 100)}`);
    }
  }
});
