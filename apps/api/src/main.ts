import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Enable graceful shutdown hooks for SIGINT/SIGTERM
  app.enableShutdownHooks();

  // Enforce 64 KB JSON body size cap to protect against buffer exhaustion attacks
  app.use(json({ limit: '64kb' }));

  // Enable trust proxy for reverse proxy platforms (e.g. Render, Railway, Vercel)
  const expressApp = app.getHttpAdapter().getInstance();
  if (expressApp && typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', 1);
  }

  // Configure CORS for local development and hosted frontend domain
  const frontendUrl = process.env.FRONTEND_URL;
  app.enableCors({
    origin: frontendUrl
      ? [frontendUrl, 'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']
      : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-API-Key',
      'x-api-key',
      'X-Correlation-Id',
      'x-correlation-id',
      'x-sandbox-session',
    ],
  });

  // Swagger / OpenAPI documentation configuration
  const config = new DocumentBuilder()
    .setTitle('HookRelay Event Dispatcher API')
    .setDescription(
      'Enterprise webhook dispatching engine: asynchronous ingestion, Outbox buffer, HMAC-SHA256 signing, and Circuit Breaker resilience.',
    )
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`HookRelay Engine running on port ${port} (http://127.0.0.1:${port})`);
  console.log(`OpenAPI documentation available at http://127.0.0.1:${port}/api/docs`);
}

bootstrap();
