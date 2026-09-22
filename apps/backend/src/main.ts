import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Seul appelant : l'app Electron (origine file:// ou serveur de dev Vite,
  // jamais fixe) — pas un frontend public, d'où une politique permissive.
  // exposedHeaders : Content-Disposition n'est pas dans la liste par défaut
  // des en-têtes de réponse lisibles côté client pour une requête
  // cross-origin (toujours le cas ici, Electron et le backend n'étant
  // jamais sur la même origine) — sans ça, authenticated-fetch.ts
  // (authenticatedFetchBlob) ne peut jamais lire le nom de fichier réel
  // renvoyé par le backend (bail-document-docx.controller.ts et les 2
  // autres générateurs, documents.controller.ts.telecharger), même quand
  // le backend l'envoie correctement. Bug latent depuis l'origine de ces
  // endpoints, masqué jusqu'ici par les noms de repli déjà suffixés en
  // .docx côté renderer — révélé par la validation d'extension du canal
  // IPC documents:ouvrirTemporaire (2026-09-22).
  app.enableCors({ exposedHeaders: ["Content-Disposition"] });
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
