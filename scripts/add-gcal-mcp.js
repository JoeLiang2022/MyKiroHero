const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE, '.kiro', 'settings', 'mcp.json');
const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
const config = JSON.parse(raw);

config.mcpServers['google-calendar'] = {
  command: 'node',
  args: [path.join(process.env.APPDATA, 'npm', 'node_modules', '@cocal', 'google-calendar-mcp', 'build', 'index.js')],
  env: {},
  disabled: false,
  autoApprove: ['list-calendars', 'list-events', 'create-event', 'update-event', 'delete-event']
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Google Calendar MCP config added successfully');
console.log(JSON.stringify(config, null, 2));
