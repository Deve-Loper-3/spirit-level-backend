const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./config/logger');
const routes = require('./routes');
const { createDocsRouter } = require('./routes/docs.routes');
const notFound = require('./middlewares/notFound.middleware');
const errorHandler = require('./middlewares/errorHandler.middleware');
const clientType = require('./middlewares/clientType.middleware');

const CORS_MAX_AGE_SECONDS = 600;

// Requests without an Origin header (native mobile apps, curl, server-to-server) are not browser
// cross-origin requests and pass through. Browser origins must be listed in CORS_ORIGINS; an
// unlisted origin just gets no CORS headers, so the browser blocks the response.
// No cookies are used (Bearer tokens), so credentials stay off.
const corsOptions = {
  origin:
    env.corsOrigins === '*'
      ? '*'
      : (origin, callback) => callback(null, !origin || env.corsOrigins.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: CORS_MAX_AGE_SECONDS,
};

const createApp = () => {
  const app = express();

  app.disable('x-powered-by');

  // Express 'trust proxy': allows req.ip and rate limiters to resolve client IP
  // from X-Forwarded-* headers when behind a reverse proxy/load balancer. Default is false (off).
  app.set('trust proxy', env.trustProxy);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(clientType);
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url.startsWith('/health') },
      customProps: (req) => ({ clientType: req.clientType }),
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api-docs', createDocsRouter());
  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
