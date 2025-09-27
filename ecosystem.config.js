module.exports = {
  apps: [
    {
      name: 'faro-rt',
      script: 'server/realtime.js',
      cwd: '/home/ubuntu/The-Dak-and-Chog-Tavern',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        GAME_TYPES: 'FARO',
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    },
    {
      name: 'poker-rt',
      script: 'server/realtime.js',
      cwd: '/home/ubuntu/The-Dak-and-Chog-Tavern',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3101',
        GAME_TYPES: 'POKER',
        ADMIN_ADDR: process.env.ADMIN_ADDR || ''
      }
    }
  ]
};
