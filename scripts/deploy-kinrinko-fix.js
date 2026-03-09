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
  // Read local file
  const content = fs.readFileSync(SRC);
  const b64 = content.toString('base64');
  console.log(`Local file: ${content.length} bytes (${(b64.length/1024/1024).toFixed(1)}MB base64)`);

  // Get current SHA from remote
  const get = await ghApi('GET', `/repos/${OWNER}/${REPO}/contents/index.html?ref=main`);
  console.log(`Remote: status=${get.status}, size=${get.data.size}, sha=${get.data.sha}`);
  
  if (get.data.size === content.length) {
    console.log('Files are same size - already deployed!');
    return;
  }

  // Upload with correct SHA
  const putBody = {
    message: 'Fix Kinrin Lake image - replace wrong motsu-nabe photo',
    content: b64,
    sha: get.data.sha,
    branch: 'main'
  };

  console.log('Uploading...');
  const put = await ghApi('PUT', `/repos/${OWNER}/${REPO}/contents/index.html`, putBody);
  console.log(`Upload status: ${put.status}`);
  
  if (put.status === 200 || put.status === 201) {
    console.log('Success! New SHA:', put.data.content.sha);
    console.log('New size:', put.data.content.size);
  } else {
    console.log('Error:', JSON.stringify(put.data).substring(0, 500));
  }
}

main().catch(e => console.error(e));
