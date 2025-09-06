module.exports = {
  apps: [
    {
      name: 'dakchog-rt',
      script: 'server/realtime.js',
      cwd: '.',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      }
    }
  ]
};

