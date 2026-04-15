// PM2 ecosystem config for SocialFlow API
// Start: pm2 start ecosystem.config.js
// Reload: pm2 reload ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'socialflow-api',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',

      // Auto-restart on crash with sane limits
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',   // if crash before 30s, count as instability
      restart_delay: 2000,

      // Memory safety: auto-restart if RSS exceeds 1 GB
      // (typical usage is 150-200 MB; 1 GB = 5x headroom for FK map + cache)
      max_memory_restart: '1G',

      // Node flags
      node_args: '--max-old-space-size=768',

      // Logs
      error_file: '/root/.pm2/logs/socialflow-api-error.log',
      out_file: '/root/.pm2/logs/socialflow-api-out.log',
      merge_logs: true,
      time: false,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
