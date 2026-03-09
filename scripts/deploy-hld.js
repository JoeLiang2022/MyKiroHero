const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'JoeLiang2022';
const REPO = 'MyKiroHero';

if (!TOKEN) { console.error('Set GH_TOKEN first'); process.exit(1); }

function ghApi(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'deploy-script',
        'Accept': 'application/vnd.github+json',
      }
    };
    if (body) opts.headers['Content-Type'] = 'application/json';
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Step 1: Push index.html to gh-pages branch via Contents API
  const src = path.join(__dirname, '..', 'docs', 'index.html');
  const content = fs.readFileSync(src);
  const b64 = content.toString('base64');
  console.log(`HLD file: ${(content.length/1024).toFixed(0)}KB`);

  // Check if file exists on gh-pages
  const get = await ghApi('GET', `/repos/${OWNER}/${REPO}/contents/index.html?ref=gh-pages`);
  let sha = null;
  if (get.status === 200 && get.data.sha) {
    sha = get.data.sha;
    console.log(`Existing sha: ${sha.substring(0,8)}...`);
  }

  const putBody = {
    message: 'Deploy HLD page',
    content: b64,
    branch: 'gh-pages'
  };
  if (sha) putBody.sha = sha;

  console.log('Uploading to gh-pages branch...');
  const put = await ghApi('PUT', `/repos/${OWNER}/${REPO}/contents/index.html`, putBody);
  console.log(`Upload status: ${put.status}`);
  if (put.status !== 200 && put.status !== 201) {
    console.log('Upload error:', JSON.stringify(put.data).substring(0, 300));
    return;
  }
  console.log('File uploaded OK');

  // Step 2: Enable GitHub Pages on gh-pages branch
  console.log('Enabling GitHub Pages...');
  const pages = await ghApi('POST', `/repos/${OWNER}/${REPO}/pages`, {
    source: { branch: 'gh-pages', path: '/' }
  });
  if (pages.status === 201) {
    console.log('Pages enabled!');
  } else if (pages.status === 409) {
    console.log('Pages already enabled, updating source...');
    const update = await ghApi('PUT', `/repos/${OWNER}/${REPO}/pages`, {
      source: { branch: 'gh-pages', path: '/' }
    });
    console.log(`Update status: ${update.status}`);
  } else {
    console.log(`Pages status: ${pages.status}`, JSON.stringify(pages.data).substring(0, 300));
  }

  console.log(`\nDone! URL: https://${OWNER}.github.io/${REPO}/`);
}

main().catch(e => console.error(e));
