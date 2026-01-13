import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://copy-flow-admin-portal-frontend.vercel.app',
      'https://copyflow-adminportal-frontend.vercel.app',
      'https://copyflow-adminportal.vercel.app',
      'https://admin-dashboard-nu-three.vercel.app',
      /https:\/\/.*-vercels-projects-.*\.vercel\.app/, // Vercel preview URLs
      '*' // TEMPORARY DEBUG: Allow all to verify connection
    ],
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
