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
        GAME_TYPES: 'FARO',
        // Optional: set ADMIN_ADDR (comma-separated lowercased addresses) before starting pm2
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    },
    // Optional second app for Poker-only realtime on a separate port.
    // Not started by default; start explicitly with:
    //   pm2 start ecosystem.config.js --only dakchog-poker-rt
    // Or restart:
    //   pm2 restart dakchog-poker-rt
    {
      name: 'dakchog-poker-rt',
      script: 'server/realtime.js',
      cwd: '.',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3101',
        GAME_TYPES: 'POKER',
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    }
  ]
};
