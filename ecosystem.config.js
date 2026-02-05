module.exports = {
  apps: [{
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
  }]
};
