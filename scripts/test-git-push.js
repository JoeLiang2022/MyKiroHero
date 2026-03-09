const { execSync } = require('child_process');
try {
  const r = execSync('git push --dry-run origin main 2>&1', { encoding: 'utf8', timeout: 15000 });
  console.log('OK:', r);
} catch(e) {
  console.log('ERR:', e.stderr || e.stdout || e.message);
}
