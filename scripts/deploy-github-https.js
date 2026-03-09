const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(ROOT, '.deploy-tmp');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  try {
    return execSync(cmd, { cwd: opts.cwd || ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
  } catch(e) {
    console.log('  ERR:', (e.stderr || e.message).trim());
    throw e;
  }
}

// Check if we can use HTTPS instead of SSH
const sshUrl = run('git remote get-url origin').trim();
console.log('Current remote:', sshUrl);

// Convert git@github.com:User/Repo.git → https://github.com/User/Repo.git
const httpsUrl = sshUrl.replace(/^git@github\.com:/, 'https://github.com/');
console.log('HTTPS URL:', httpsUrl);

// Try to set remote to HTTPS temporarily
run(`git remote set-url origin ${httpsUrl}`);
console.log('Switched to HTTPS');

// Try dry-run push
try {
  const result = run('git push --dry-run origin main 2>&1');
  console.log('Push test OK:', result);
  
  // If push works, deploy gh-pages
  if (fs.existsSync(DEPLOY_DIR)) fs.rmSync(DEPLOY_DIR, { recursive: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  
  fs.copyFileSync(
    path.join(ROOT, 'public', 'fukuoka.html'),
    path.join(DEPLOY_DIR, 'index.html')
  );
  
  run('git init', { cwd: DEPLOY_DIR });
  run('git checkout -b gh-pages', { cwd: DEPLOY_DIR });
  run('git config user.email "joe_liang2208116@jabil.com"', { cwd: DEPLOY_DIR });
  run('git config user.name "Joe Liang"', { cwd: DEPLOY_DIR });
  run('git add -A', { cwd: DEPLOY_DIR });
  run('git commit -m "Deploy Fukuoka trip"', { cwd: DEPLOY_DIR });
  run(`git remote add origin ${httpsUrl}`, { cwd: DEPLOY_DIR });
  run('git push -f origin gh-pages', { cwd: DEPLOY_DIR });
  
  fs.rmSync(DEPLOY_DIR, { recursive: true });
  console.log('\n✅ Deployed to GitHub Pages!');
} catch(e) {
  console.log('\nHTTPS push also failed. Need GitHub credentials.');
  console.log('Options:');
  console.log('1. Run: git config --global credential.helper manager');
  console.log('2. Or set GH_TOKEN environment variable');
} finally {
  // Restore SSH remote
  run(`git remote set-url origin ${sshUrl}`);
  console.log('Restored SSH remote');
}
