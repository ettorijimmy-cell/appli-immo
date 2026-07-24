import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Seul appelant : l'app Electron (origine file:// ou serveur de dev Vite,
  // jamais fixe) — pas un frontend public, d'où une politique permissive.
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
