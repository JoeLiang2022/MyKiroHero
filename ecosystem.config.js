const fs = require('fs');
const path = require('path');

const parentDir = path.dirname(__dirname);

// Check for BugTracker (or legacy IssueTracker) as sibling folder.
// This is opt-in by folder presence — if the folder doesn't exist, nothing is added.
function findBugTracker() {
  for (const name of ['BugTracker', 'IssueTracker']) {
    const dir = path.join(parentDir, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) return { name, dir };
  }
  return null;
}

const apps = [
  {
    name: 'gateway',
    script: 'src/gateway/index.js',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    env: {
      NODE_ENV: 'production'
    }
  },
  {
    name: 'recall-worker',
    script: 'src/memory/engine.js',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 2000,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production'
    }
  }
];

const bt = findBugTracker();
if (bt) {
  apps.push({
    name: 'bug-tracker',
    script: 'src/server.js',
    cwd: bt.dir,
    watch: false,
    autorestart: true,
    max_restarts: 5,
    restart_delay: 2000,
    env: {
      NODE_ENV: 'production'
    }
  });
}

module.exports = { apps };
