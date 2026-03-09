const https = require('https');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'JoeLiang2022';
const REPO = 'fukuoka-trip';

function ghApi(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'User-Agent': 'verify-script',
        'Accept': 'application/vnd.github+json',
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, data: raw.substring(0, 500) }); }
      });
    }).on('error', reject);
  });
}

async function main() {
  // Check repo info
  const repo = await ghApi(`/repos/${OWNER}/${REPO}`);
  console.log('Repo:', repo.status, repo.data.full_name);
  console.log('Default branch:', repo.data.default_branch);
  
  // List branches
  const branches = await ghApi(`/repos/${OWNER}/${REPO}/branches`);
  console.log('Branches:', branches.data.map(b => b.name));
  
  // Check gh-pages branch content
  const contents = await ghApi(`/repos/${OWNER}/${REPO}/contents/index.html?ref=gh-pages`);
  console.log('gh-pages index.html:', contents.status);
  if (contents.data) {
    console.log('  Size:', contents.data.size, 'bytes');
    console.log('  SHA:', contents.data.sha);
  }

  // Check main branch content
  const mainContents = await ghApi(`/repos/${OWNER}/${REPO}/contents/index.html?ref=main`);
  console.log('main index.html:', mainContents.status);
  if (mainContents.data && mainContents.data.size) {
    console.log('  Size:', mainContents.data.size, 'bytes');
  }

  // Check Pages config
  const pages = await ghApi(`/repos/${OWNER}/${REPO}/pages`);
  console.log('Pages config:', pages.status);
  if (pages.data) {
    console.log('  Source:', JSON.stringify(pages.data.source));
    console.log('  URL:', pages.data.html_url);
    console.log('  Status:', pages.data.status);
  }
}

main().catch(e => console.error(e));
