import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  // Serve static assets out of the public directory (for the favicon)
  app.useStaticAssets(join(__dirname, '..', 'public'));

  const config = new DocumentBuilder()
    .setTitle('CopyFlow API')
    .setDescription('CopyFlow Print Network Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Node', 'Windows client endpoints')
    .addTag('Admin', 'Admin portal endpoints')
    .addTag('Payment', 'Payment webhook endpoints')
    .addTag('WhatsApp', 'WhatsApp bot endpoints')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    customfavIcon: '/favicon.jpg',
    customSiteTitle: 'CopyFlow API',
  });

  app.enableShutdownHooks();
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
