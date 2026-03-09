const https = require('https');
const TOKEN = process.env.GH_TOKEN;
const opts = {
  hostname: 'api.github.com',
  path: '/repos/JoeLiang2022/fukuoka-trip/contents/index.html?ref=main',
  headers: {
    'Authorization': 'Bearer ' + TOKEN,
    'User-Agent': 'check',
    'Accept': 'application/vnd.github+json'
  }
};
https.get(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const j = JSON.parse(d);
    console.log('GitHub file size:', j.size);
    const html = Buffer.from(j.content, 'base64').toString('utf8');
    console.log('Has hero section:', html.includes('class="hero"'));
    console.log('Has day-nav:', html.includes('day-nav'));
    console.log('Has timeline:', html.includes('tl-item'));
    console.log('Has parallax JS:', html.includes('IntersectionObserver'));
    console.log('Has day5:', html.includes('id="day5"'));
    console.log('First 200 chars:', html.substring(0, 200));
  });
});
