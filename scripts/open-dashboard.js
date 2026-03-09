#!/usr/bin/env node
/**
 * Open Mission Control Dashboard in default browser
 * Reads port from .gateway-port file
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const portFile = path.join(__dirname, '..', '.gateway-port');

if (!fs.existsSync(portFile)) {
  console.error('Gateway not running — .gateway-port not found');
  console.error('Start gateway first: pm2 start gateway');
  process.exit(1);
}

const port = fs.readFileSync(portFile, 'utf-8').trim();
if (!port || isNaN(port)) {
  console.error('Invalid port in .gateway-port:', port);
  process.exit(1);
}

const url = `http://localhost:${port}/dashboard`;
console.log(`Opening ${url} ...`);

const cmd = process.platform === 'win32' ? `start "" "${url}"`
  : process.platform === 'darwin' ? `open ${url}`
  : `xdg-open ${url}`;

exec(cmd, { shell: true }, (err) => {
  if (err) console.error('Failed to open browser:', err.message);
  else console.log('Done');
});
