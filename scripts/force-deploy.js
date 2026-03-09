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
    return execSync(cmd, { encoding: 'utf8', cwd: DEPLOY_DIR }).trim();
  } catch(e) {
    console.log('stderr:', e.stderr);
    return e.stdout;
  }
}

// Copy fresh file
fs.copyFileSync(SRC, path.join(DEPLOY_DIR, 'index.html'));
console.log('Copied fresh fukuoka.html -> index.html');

const size = fs.statSync(path.join(DEPLOY_DIR, 'index.html')).size;
console.log(`File size: ${(size/1024).toFixed(0)}KB`);

// Check git status
console.log(run('git status'));
console.log(run('git log --oneline -3'));

// Force a new commit by adding a timestamp comment
const html = fs.readFileSync(path.join(DEPLOY_DIR, 'index.html'), 'utf8');
const ts = new Date().toISOString();
const updated = html.replace('</html>', `<!-- deployed: ${ts} -->\n</html>`);
fs.writeFileSync(path.join(DEPLOY_DIR, 'index.html'), updated);

run('git add index.html');
run('git commit -m "Force deploy with embedded base64 images"');
const pushResult = run(`git push https://${TOKEN}@github.com/${OWNER}/${REPO}.git main --force`);
console.log('Push result:', pushResult);
console.log(`\nDone! URL: https://${OWNER}.github.io/${REPO}/`);
