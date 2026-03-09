const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const FILE = path.join(__dirname, '..', 'public', 'fukuoka.html');
const content = fs.readFileSync(FILE);

// Use 0x0.st - simple file hosting, no auth needed
const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fukuoka.html"\r\nContent-Type: text/html\r\n\r\n`),
  content,
  Buffer.from(`\r\n--${boundary}--\r\n`)
]);

console.log('Uploading to 0x0.st...');
console.log(`File size: ${(content.length / 1024).toFixed(0)} KB`);

const req = https.request({
  hostname: '0x0.st',
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
    'User-Agent': 'curl/8.0'
  }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    if (res.statusCode === 200) {
      const url = data.trim();
      console.log(`\n✅ Uploaded!`);
      console.log(`🔗 ${url}`);
      fs.writeFileSync(path.join(__dirname, '..', '.deploy-url'), url);
    } else {
      console.log(`❌ HTTP ${res.statusCode}: ${data}`);
    }
  });
});
req.on('error', e => console.error('❌', e.message));
req.write(body);
req.end();
