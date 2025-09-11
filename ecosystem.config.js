module.exports = {
  apps: [
    {
      name: 'dakchog-rt',
      script: 'server/realtime.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        // Optional: set ADMIN_ADDR (comma-separated lowercased addresses) before starting pm2
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    }
  ]
};
