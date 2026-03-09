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
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd.replace(TOKEN, '***')}`);
  return execSync(cmd, { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
}

async function main() {
  // Step 1: Check who we are
  console.log('Checking GitHub user...');
  const user = await ghApi('GET', '/user');
  if (user.status !== 200) {
    console.error('Token invalid:', user.data.message);
    process.exit(1);
  }
  const username = user.data.login;
  console.log(`Logged in as: ${username}`);

  // Step 2: Check if repo exists, create if not
  const repoName = 'fukuoka-trip';
  console.log(`Checking repo ${username}/${repoName}...`);
  const repo = await ghApi('GET', `/repos/${username}/${repoName}`);
  
  if (repo.status === 404) {
    console.log('Repo not found, creating...');
    const create = await ghApi('POST', '/user/repos', {
      name: repoName,
      description: '🇯🇵 福岡五日遊行程 Fukuoka 5-Day Trip Itinerary',
      homepage: `https://${username}.github.io/${repoName}/`,
      private: false,
      has_issues: false,
      has_wiki: false,
      auto_init: false
    });
    if (create.status >= 400) {
      console.error('Failed to create repo:', create.data.message);
      process.exit(1);
    }
    console.log('✅ Repo created');
  } else {
    console.log('Repo exists');
  }

  // Step 3: Prepare deploy directory
  if (fs.existsSync(DEPLOY_DIR)) fs.rmSync(DEPLOY_DIR, { recursive: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.copyFileSync(SRC, path.join(DEPLOY_DIR, 'index.html'));
  console.log('Prepared index.html');

  // Step 4: Git init and push
  const remoteUrl = `https://x-access-token:${TOKEN}@github.com/${username}/${repoName}.git`;
  
  run('git init', { cwd: DEPLOY_DIR });
  run('git checkout -b gh-pages', { cwd: DEPLOY_DIR });
  run('git config user.email "joe_liang2208116@jabil.com"', { cwd: DEPLOY_DIR });
  run('git config user.name "Joe Liang"', { cwd: DEPLOY_DIR });
  run('git add -A', { cwd: DEPLOY_DIR });
  run('git commit -m "Deploy Fukuoka trip itinerary"', { cwd: DEPLOY_DIR });
  run(`git remote add origin ${remoteUrl}`, { cwd: DEPLOY_DIR });
  
  console.log('Pushing to gh-pages...');
  run('git push -f origin gh-pages', { cwd: DEPLOY_DIR });
  console.log('✅ Pushed!');

  // Step 5: Enable GitHub Pages
  console.log('Enabling GitHub Pages...');
  const pages = await ghApi('POST', `/repos/${username}/${repoName}/pages`, {
    source: { branch: 'gh-pages', path: '/' }
  });
  if (pages.status < 400) {
    console.log('✅ GitHub Pages enabled');
  } else {
    console.log('Pages status:', pages.status, pages.data.message || '');
  }

  // Cleanup
  fs.rmSync(DEPLOY_DIR, { recursive: true });

  const url = `https://${username}.github.io/${repoName}/`;
  console.log(`\n🎉 Done! URL: ${url}`);
  console.log('(May take 1-2 minutes to go live)');
  
  fs.writeFileSync(path.join(ROOT, '.deploy-url'), url);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
