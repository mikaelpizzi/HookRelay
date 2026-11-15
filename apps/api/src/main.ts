import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-API-Key',
      'x-api-key',
      'X-Correlation-Id',
      'x-correlation-id',
    ],
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`HookRelay Engine running on port ${port}`);
}

bootstrap();

