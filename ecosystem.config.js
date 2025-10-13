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
    },
    {
      name: 'dcmon-agent',
      script: 'server/dcmon-agent.js',
      cwd: '/home/ubuntu/The-Dak-and-Chog-Tavern',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      min_uptime: '5s',
      max_restarts: 50,
      node_args: '--enable-source-maps',
      out_file: '/var/log/tavern/dcmon-agent.out.log',
      error_file: '/var/log/tavern/dcmon-agent.err.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        DCMON_LOG_LEVEL: process.env.DCMON_LOG_LEVEL || 'info',
        DCMON_POKER_TABLES: process.env.DCMON_POKER_TABLES || '0x681BADA5D0d012ABEB9f8A8F0E38758396DE0db3',
        DCMON_POKER_GAS_LIMIT: process.env.DCMON_POKER_GAS_LIMIT || '0'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};

