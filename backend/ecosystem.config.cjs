/**
 * PM2 进程管理配置
 *
 * 使用方式：
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart aie-backend
 *   pm2 logs aie-backend
 *   pm2 stop aie-backend
 *   pm2 delete aie-backend
 *
 * 开机自启：
 *   pm2 startup
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'aie-backend',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      env_file: '.env',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
