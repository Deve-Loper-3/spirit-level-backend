const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password'],
  ...(env.isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

module.exports = logger;
