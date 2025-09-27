module.exports = {
  apps: [
    {
      name: 'faro-rt',
      script: 'server/realtime.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        GAME_TYPES: 'FARO',
        // Optional: set ADMIN_ADDR (comma-separated lowercased addresses) before starting pm2
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    },
    {
      name: 'holdempoker-rt',
      script: 'server/poker-rt-bootstrap.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3101'
      }
    }
  ]
};
