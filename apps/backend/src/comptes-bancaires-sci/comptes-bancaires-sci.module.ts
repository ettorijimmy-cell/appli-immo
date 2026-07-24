import { Module } from "@nestjs/common";
import { ComptesBancairesSciController } from "./comptes-bancaires-sci.controller";
import { ComptesBancairesSciService } from "./comptes-bancaires-sci.service";

@Module({
  controllers: [ComptesBancairesSciController],
  providers: [ComptesBancairesSciService]
})
export class ComptesBancairesSciModule {}
