// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rt-all',
      script: 'server/realtime.js',
      cwd: '/home/ubuntu/The-Dak-and-Chog-Tavern',

      // Socket.IO behind Nginx: keep a single process (no cluster/sticky needed)
      instances: 1,
      exec_mode: 'fork',

      node_args: '--enable-source-maps',
      watch: false,
      autorestart: true,
      min_uptime: '5s',
      max_restarts: 50,
      max_memory_restart: '400M',

      // Logs (make sure /var/log/tavern exists and is writable by your user)
      out_file: '/var/log/tavern/rt-all.out.log',
      error_file: '/var/log/tavern/rt-all.err.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        GAME_TYPES: 'FARO,POKER',
        // Comma-separated, LOWERCASE wallet addresses with admin rights:
        ADMIN_ADDR: '0xyouradminwalletlowercase',
        RT_RAKE_BPS: 100
      },

      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
