const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'JoeLiang2022';
const REPO = 'fukuoka-trip';
const SRC = path.join(__dirname, '..', 'public', 'fukuoka.html');
const DEPLOY_DIR = path.join(__dirname, '..', '.deploy-tmp');

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: DEPLOY_DIR, stdio: ['pipe','pipe','pipe'] }).trim();
  } catch(e) {
    console.log('stdout:', (e.stdout||'').trim());
    console.log('stderr:', (e.stderr||'').trim());
    throw e;
  }
}

// Check current branch
const branch = run('git branch --show-current');
console.log('Current branch:', branch);

// Copy fresh file with timestamp
const html = fs.readFileSync(SRC, 'utf8');
const ts = new Date().toISOString();
const updated = html.replace('</html>', `<!-- deployed: ${ts} -->\n</html>`);
fs.writeFileSync(path.join(DEPLOY_DIR, 'index.html'), updated);
console.log(`Written index.html: ${Math.round(updated.length/1024)}KB`);

run('git add index.html');
console.log(run('git status --short'));
run('git commit -m "Deploy with all images embedded as base64"');

// Push to the correct branch (gh-pages)
const pushUrl = `https://${TOKEN}@github.com/${OWNER}/${REPO}.git`;
const result = run(`git push ${pushUrl} ${branch} --force`);
console.log('Push result:', result);
console.log(`\nDeployed to ${branch}! URL: https://${OWNER}.github.io/${REPO}/`);
