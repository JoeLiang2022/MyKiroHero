const https = require('https');
const TOKEN = process.env.GH_TOKEN;

https.get({
  hostname: 'api.github.com',
  path: '/repos/JoeLiang2022/fukuoka-trip/contents/index.html?ref=main',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'User-Agent': 'x',
    'Accept': 'application/vnd.github+json',
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const j = JSON.parse(d);
    console.log('Remote size:', j.size, 'bytes');
    console.log('Remote SHA:', j.sha);
    console.log('Local size:', require('fs').statSync('public/fukuoka.html').size, 'bytes');
    console.log('Match?', j.size === require('fs').statSync('public/fukuoka.html').size);
  });
});
