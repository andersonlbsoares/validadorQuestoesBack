const path = require('path');
const swaggerAutogen = require('swagger-autogen')({ openapi: '3.0.0' });

const outputFile = path.join(__dirname, '..', 'swagger-output.json');
const endpointsFiles = [
  path.join(__dirname, '..', 'server.js'),
  path.join(__dirname, '..', 'routes', 'auth.js'),
  path.join(__dirname, '..', 'routes', 'questions.js'),
  path.join(__dirname, '..', 'routes', 'upload.js'),
];

const doc = {
  info: {
    title: 'Validador de Questões API',
    description: 'Documentação interativa gerada automaticamente a partir das rotas.',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Ambiente local',
    },
  ],
  security: [
    {
      bearerAuth: [],
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};

swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
  console.log('Swagger gerado em swagger-output.json');
});
