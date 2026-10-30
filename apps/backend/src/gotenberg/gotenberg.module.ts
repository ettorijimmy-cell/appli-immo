import { Module } from "@nestjs/common";
import { GotenbergService } from "./gotenberg.service";

// Pas encore importé par AppModule : aucun consommateur avant le service
// de génération PDF (prochain commit) — voir gotenberg.service.ts.
@Module({
  providers: [GotenbergService],
  exports: [GotenbergService]
})
export class GotenbergModule {}
