const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(ROOT, '.deploy-tmp');
const SRC = path.join(ROOT, 'public', 'fukuoka.html');

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
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, headers: res.headers, data: raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function run(cmd, opts = {}) {
  const display = cmd.replace(new RegExp(TOKEN, 'g'), '***');
  console.log(`> ${display}`);
  return execSync(cmd, { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
}

async function main() {
  // Check token scopes
  const user = await ghApi('GET', '/user');
  console.log(`User: ${user.data.login}`);
  console.log(`Scopes: ${user.headers['x-oauth-scopes'] || 'none (fine-grained token)'}`);
  
  // List repos to see what we have access to
  const repos = await ghApi('GET', '/user/repos?per_page=10&sort=updated');
  if (repos.status === 200) {
    console.log('\nAccessible repos:');
    for (const r of repos.data) {
      console.log(`  - ${r.full_name} (${r.private ? 'private' : 'public'})`);
    }
  }

  // Try to create repo with different approach
  console.log('\nTrying to create fukuoka-trip repo...');
  const create = await ghApi('POST', '/user/repos', {
    name: 'fukuoka-trip',
    description: 'Fukuoka Trip Itinerary',
    private: false,
    auto_init: true
  });
  console.log(`Create status: ${create.status}`);
  if (create.status >= 400) {
    console.log('Create error:', JSON.stringify(create.data));
    
    // Maybe the token only has access to specific repos
    // Try pushing to an existing repo
    console.log('\nToken may be fine-grained with limited repo access.');
    console.log('Checking NorlWu-TW/MyKiroHero...');
    const existing = await ghApi('GET', '/repos/NorlWu-TW/MyKiroHero');
    console.log(`Existing repo status: ${existing.status}`);
    if (existing.status === 200) {
      console.log('Found! Deploying to gh-pages branch...');
      await deployToRepo('NorlWu-TW', 'MyKiroHero');
      return;
    }
    
    // Check JoeLiang2022 repos
    const joeRepo = await ghApi('GET', '/repos/JoeLiang2022/fukuoka-trip');
    if (joeRepo.status === 200) {
      console.log('fukuoka-trip already exists!');
      await deployToRepo('JoeLiang2022', 'fukuoka-trip');
      return;
    }
    
    console.log('\n❌ Cannot create or access repos. Token needs "repo" scope or "Contents" permission.');
    process.exit(1);
  } else {
    console.log('✅ Repo created!');
    await deployToRepo(user.data.login, 'fukuoka-trip');
  }
}

async function deployToRepo(owner, repo) {
  if (fs.existsSync(DEPLOY_DIR)) fs.rmSync(DEPLOY_DIR, { recursive: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.copyFileSync(SRC, path.join(DEPLOY_DIR, 'index.html'));

  const remoteUrl = `https://x-access-token:${TOKEN}@github.com/${owner}/${repo}.git`;
  
  run('git init', { cwd: DEPLOY_DIR });
  run('git checkout -b gh-pages', { cwd: DEPLOY_DIR });
  run('git config user.email "joe_liang2208116@jabil.com"', { cwd: DEPLOY_DIR });
  run('git config user.name "Joe Liang"', { cwd: DEPLOY_DIR });
  run('git add -A', { cwd: DEPLOY_DIR });
  run('git commit -m "Deploy Fukuoka trip itinerary"', { cwd: DEPLOY_DIR });
  run(`git remote add origin ${remoteUrl}`, { cwd: DEPLOY_DIR });
  
  console.log('Pushing...');
  run('git push -f origin gh-pages', { cwd: DEPLOY_DIR });
  console.log('✅ Pushed!');

  // Enable Pages
  const pages = await ghApi('POST', `/repos/${owner}/${repo}/pages`, {
    source: { branch: 'gh-pages', path: '/' }
  });
  console.log(`Pages: ${pages.status} ${pages.data.message || 'OK'}`);

  fs.rmSync(DEPLOY_DIR, { recursive: true });
  const url = `https://${owner}.github.io/${repo}/`;
  console.log(`\n🎉 ${url}`);
  fs.writeFileSync(path.join(ROOT, '.deploy-url'), url);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
