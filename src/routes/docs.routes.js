const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const SPEC_PATH = path.join(__dirname, '../../docs/openapi.yaml');

const loadOpenApiDocument = () => {
  const raw = fs.readFileSync(SPEC_PATH, 'utf8');
  return YAML.parse(raw);
};

const createDocsRouter = () => {
  const router = Router();
  const document = loadOpenApiDocument();

  router.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(fs.readFileSync(SPEC_PATH, 'utf8'));
  });

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  router.use(
    '/',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Spirit Level API Docs',
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );

  return router;
};

module.exports = { createDocsRouter };
