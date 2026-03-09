const https = require('https');

const url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Ichiran_Ramen.JPG/400px-Ichiran_Ramen.JPG';

console.log('Testing download from:', url);
const start = Date.now();

const req = https.get(url, { 
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 15000
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers).substring(0, 200));
  if (res.statusCode === 301 || res.statusCode === 302) {
    console.log('Redirect to:', res.headers.location);
  }
  let size = 0;
  res.on('data', c => size += c.length);
  res.on('end', () => {
    console.log('Downloaded:', size, 'bytes in', Date.now() - start, 'ms');
  });
});

req.on('error', e => console.log('Error:', e.message));
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); });
