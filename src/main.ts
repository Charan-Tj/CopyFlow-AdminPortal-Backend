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
  SwaggerModule.setup('api', app, document);

  app.enableShutdownHooks();
  await app.listen(3000);
}
bootstrap();
