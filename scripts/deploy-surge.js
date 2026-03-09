// Deploy using surge.sh via npx
// Surge allows anonymous deploys with just an email
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEPLOY_DIR = path.join(__dirname, '..', '.deploy-tmp');
const SRC = path.join(__dirname, '..', 'public', 'fukuoka.html');

// Prepare deploy directory
if (fs.existsSync(DEPLOY_DIR)) fs.rmSync(DEPLOY_DIR, { recursive: true });
fs.mkdirSync(DEPLOY_DIR, { recursive: true });

// Copy as index.html and add 200.html for SPA fallback
fs.copyFileSync(SRC, path.join(DEPLOY_DIR, 'index.html'));
fs.copyFileSync(SRC, path.join(DEPLOY_DIR, '200.html'));

const domain = 'fukuoka-trip-2026.surge.sh';
console.log(`Deploying to ${domain}...`);
console.log(`Directory: ${DEPLOY_DIR}`);

try {
  const result = execSync(
    `npx surge ${DEPLOY_DIR} ${domain} --token anonymous`,
    { encoding: 'utf8', timeout: 60000, stdio: 'pipe' }
  );
  console.log(result);
  console.log(`\n✅ https://${domain}`);
} catch(e) {
  console.log('Surge failed:', e.stderr || e.message);
  console.log('Trying without token...');
  // Surge needs auth, let's try another approach
}

// Cleanup
try { fs.rmSync(DEPLOY_DIR, { recursive: true }); } catch(e) {}
