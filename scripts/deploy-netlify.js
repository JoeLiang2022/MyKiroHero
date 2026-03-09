const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// Netlify allows anonymous deploys via their API
// We'll create a zip and upload it

const FILE = path.join(__dirname, '..', 'public', 'fukuoka.html');

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

async function deploy() {
  const html = fs.readFileSync(FILE);
  const hash = sha1(html);
  
  console.log('Deploying to Netlify...');
  console.log(`File size: ${(html.length / 1024).toFixed(0)} KB`);
  console.log(`SHA1: ${hash}`);

  // Step 1: Create site + deploy with file digest
  const createBody = JSON.stringify({
    files: { '/index.html': hash }
  });

  const siteRes = await httpRequest('POST', 'api.netlify.com', '/api/v1/sites', createBody);
  const site = JSON.parse(siteRes);
  
  if (!site.id) {
    console.error('Failed to create site:', siteRes);
    process.exit(1);
  }

  console.log(`Site created: ${site.ssl_url || site.url}`);
  const deployId = site.deploy_id || (site.published_deploy && site.published_deploy.id);
  
  if (!deployId) {
    console.error('No deploy ID found:', JSON.stringify(site, null, 2));
    process.exit(1);
  }

  // Step 2: Upload the file
  console.log(`Uploading index.html (deploy: ${deployId})...`);
  const uploadRes = await httpRequest(
    'PUT',
    'api.netlify.com',
    `/api/v1/deploys/${deployId}/files/index.html`,
    html,
    'application/octet-stream'
  );

  console.log('\n✅ Deployed!');
  console.log(`🔗 ${site.ssl_url || site.url}`);
  
  // Save URL for reference
  fs.writeFileSync(path.join(__dirname, '..', '.deploy-url'), site.ssl_url || site.url);
}

function httpRequest(method, host, urlPath, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: host,
      path: urlPath,
      method,
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'deploy-script/1.0'
      }
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

deploy().catch(e => { console.error('❌', e.message); process.exit(1); });
