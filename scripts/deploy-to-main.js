const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'JoeLiang2022';
const REPO = 'fukuoka-trip';
const SRC = path.join(__dirname, '..', 'public', 'fukuoka.html');

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
  const content = fs.readFileSync(SRC);
  const b64 = content.toString('base64');
  console.log(`File size: ${(content.length/1024).toFixed(0)}KB, base64: ${(b64.length/1024).toFixed(0)}KB`);

  // Get existing file sha on main branch
  const get = await ghApi('GET', `/repos/${OWNER}/${REPO}/contents/index.html?ref=main`);
  let sha = null;
  if (get.status === 200 && get.data.sha) {
    sha = get.data.sha;
    console.log(`Existing main sha: ${sha.substring(0,8)}... size: ${get.data.size}`);
  }

  const putBody = {
    message: 'Deploy with all images embedded as base64',
    content: b64,
    branch: 'main'
  };
  if (sha) putBody.sha = sha;

  console.log(`Uploading ${(b64.length/1024/1024).toFixed(1)}MB to main branch...`);
  const put = await ghApi('PUT', `/repos/${OWNER}/${REPO}/contents/index.html`, putBody);
  console.log(`Status: ${put.status}`);
  if (put.status === 200 || put.status === 201) {
    console.log('Success! Deployed to main branch.');
    console.log(`URL: https://${OWNER}.github.io/${REPO}/`);
  } else {
    console.log('Error:', JSON.stringify(put.data).substring(0, 500));
  }
}

main().catch(e => console.error(e));
