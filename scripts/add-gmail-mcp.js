const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE, '.kiro', 'settings', 'mcp.json');
const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
const config = JSON.parse(raw);

config.mcpServers['gmail'] = {
  command: 'npx',
  args: ['-y', '@shinzolabs/gmail-mcp'],
  env: {},
  disabled: false,
  autoApprove: ['send_email', 'create_draft', 'get_profile', 'search_emails', 'read_email']
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Gmail MCP config added successfully');
