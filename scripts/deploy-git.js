const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'JoeLiang2022';
const REPO = 'fukuoka-trip';
const SRC = path.join(__dirname, '..', 'public', 'fukuoka.html');
const DEPLOY_DIR = path.join(__dirname, '..', '.deploy-tmp');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', cwd: DEPLOY_DIR, ...opts }).trim();
}

async function main() {
  const fileSize = fs.statSync(SRC).size;
  console.log(`Source file: ${(fileSize/1024).toFixed(0)}KB`);

  // Ensure deploy dir exists and is a git repo
  if (!fs.existsSync(path.join(DEPLOY_DIR, '.git'))) {
    fs.mkdirSync(DEPLOY_DIR, { recursive: true });
    run('git init');
    run('git checkout -b main');
    run(`git remote add origin https://${TOKEN}@github.com/${OWNER}/${REPO}.git`);
  }

  // Pull latest
  try {
    run('git fetch origin main');
    run('git reset --hard origin/main');
  } catch(e) {
    console.log('No remote main yet, starting fresh');
  }

  // Copy file
  fs.copyFileSync(SRC, path.join(DEPLOY_DIR, 'index.html'));
  console.log('Copied fukuoka.html -> index.html');

  // Git config
  run('git config user.email "joe_liang2208116@jabil.com"');
  run('git config user.name "Joe Liang"');

  // Commit and push
  run('git add index.html');
  try {
    run('git commit -m "Deploy with embedded images"');
  } catch(e) {
    console.log('Nothing to commit (no changes)');
    return;
  }
  
  run(`git push -f https://${TOKEN}@github.com/${OWNER}/${REPO}.git main`);
  console.log(`\nDeployed! URL: https://${OWNER}.github.io/${REPO}/`);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
