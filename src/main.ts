import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: true, // Allow all origins by reflecting the request origin (required for credentials: true)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Copy Flow API')
    .setDescription('The Copy Flow Print Kiosk Backend API')
    .setVersion('1.0')
    .addTag('Kiosks')
    .addApiKey({ type: 'apiKey', name: 'x-kiosk-id', in: 'header' }, 'x-kiosk-id')
    .addApiKey({ type: 'apiKey', name: 'x-kiosk-secret', in: 'header', description: 'Kiosk secret for authentication' }, 'x-kiosk-secret')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
bootstrap();
