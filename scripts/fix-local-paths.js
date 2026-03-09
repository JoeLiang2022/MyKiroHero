const fs = require('fs');
let h = fs.readFileSync('public/fukuoka.html', 'utf8');

// Replace all remaining local image paths with Wikimedia URLs
const replacements = {
  "images/Fukuoka_Airport_Domestic_Terminal.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Fukuoka_Airport_Domestic_Terminal.jpg/1280px-Fukuoka_Airport_Domestic_Terminal.jpg",
  "images/Nakasu_at_night.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Nakasu_at_night.jpg/960px-Nakasu_at_night.jpg",
  "images/Motsunabe.jpg": "https://upload.wikimedia.org/wikipedia/commons/6/61/Motsunabe.jpg",
};

for (const [local, remote] of Object.entries(replacements)) {
  const count = h.split(local).length - 1;
  if (count > 0) {
    h = h.split(local).join(remote);
    console.log(`Replaced ${count}x: ${local}`);
  }
}

fs.writeFileSync('public/fukuoka.html', h, 'utf8');

// Verify no more local image paths
const remaining = (h.match(/images\//g) || []).length;
console.log(`\nRemaining local image refs: ${remaining}`);

// Count all wikimedia URLs
const wikiUrls = (h.match(/upload\.wikimedia\.org/g) || []).length;
console.log(`Wikimedia URLs: ${wikiUrls}`);
