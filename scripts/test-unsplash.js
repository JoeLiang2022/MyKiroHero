const https = require('https');

// Test Unsplash download
const url = 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&h=180&fit=crop';

console.log('Testing Unsplash download...');
const start = Date.now();

const req = https.get(url, { timeout: 15000 }, (res) => {
  console.log('Status:', res.statusCode);
  if (res.statusCode === 301 || res.statusCode === 302) {
    console.log('Redirect to:', res.headers.location);
    // Follow redirect
    https.get(res.headers.location, { timeout: 15000 }, (res2) => {
      console.log('Redirect status:', res2.statusCode);
      let size = 0;
      res2.on('data', c => size += c.length);
      res2.on('end', () => console.log('Downloaded:', size, 'bytes in', Date.now() - start, 'ms'));
    });
    return;
  }
  let size = 0;
  res.on('data', c => size += c.length);
  res.on('end', () => console.log('Downloaded:', size, 'bytes in', Date.now() - start, 'ms'));
});

req.on('error', e => console.log('Error:', e.message));
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); });
