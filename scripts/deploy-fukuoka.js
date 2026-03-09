const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(ROOT, '.deploy-tmp');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });
}

async function main() {
  // Clean up
  if (fs.existsSync(DEPLOY_DIR)) {
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });

  // Copy the HTML file (use the external-image version for web, rename to index.html)
  const src = path.join(ROOT, 'public', 'fukuoka.html');
  const dest = path.join(DEPLOY_DIR, 'index.html');
  fs.copyFileSync(src, dest);
  console.log('Copied fukuoka.html → index.html');

  // Init git in deploy dir
  run('git init', { cwd: DEPLOY_DIR });
  run('git checkout -b gh-pages', { cwd: DEPLOY_DIR });
  run('git config user.email "joe_liang2208116@jabil.com"', { cwd: DEPLOY_DIR });
  run('git config user.name "Joe Liang"', { cwd: DEPLOY_DIR });
  run('git add -A', { cwd: DEPLOY_DIR });
  run('git commit -m "Deploy Fukuoka trip itinerary"', { cwd: DEPLOY_DIR });

  // Force push to gh-pages branch of origin
  const remoteUrl = run('git remote get-url origin').trim();
  console.log(`Remote: ${remoteUrl}`);
  run(`git remote add origin ${remoteUrl}`, { cwd: DEPLOY_DIR });
  run('git push -f origin gh-pages', { cwd: DEPLOY_DIR });

  // Clean up
  fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });

  console.log('\n✅ Deployed!');
  console.log(`URL: https://norlwu-tw.github.io/MyKiroHero/`);
  console.log('(May take 1-2 minutes for GitHub Pages to activate)');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
