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
        catch(e) { resolve({ status: res.statusCode, data: raw }); }
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
  console.log(`Uploading index.html (${(content.length/1024).toFixed(0)} KB)...`);

  // Get existing file sha if it exists
  let sha = null;
  const get = await ghApi('GET', `/repos/${OWNER}/${REPO}/contents/index.html?ref=main`);
  if (get.status === 200 && get.data && get.data.sha) {
    sha = get.data.sha;
    console.log(`Existing file found, sha: ${sha.slice(0,8)}...`);
  }

  const putBody = {
    message: 'Update Fukuoka trip itinerary - enriched descriptions',
    content: b64,
    branch: 'main'
  };
  if (sha) putBody.sha = sha;

  const put = await ghApi('PUT', `/repos/${OWNER}/${REPO}/contents/index.html`, putBody);
  console.log(`Upload status: ${put.status}`);
  if (put.status === 200 || put.status === 201) {
    console.log('File uploaded!');
  } else {
    console.log('Error:', JSON.stringify(put.data).slice(0, 300));
    process.exit(1);
  }

  const url = `https://${OWNER}.github.io/${REPO}/`;
  console.log(`URL: ${url}`);
  fs.writeFileSync(path.join(__dirname, '..', '.deploy-url'), url);
}

main().catch(e => { console.error(e.message); process.exit(1); });
