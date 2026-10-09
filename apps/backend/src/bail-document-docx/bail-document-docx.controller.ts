import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { BailDocumentDocxService } from "./bail-document-docx.service";
import { GenererDocumentBailDocxDto } from "./dto/generer-document-bail-docx.dto";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

@Controller("baux")
export class BailDocumentDocxController {
  constructor(private readonly bailDocumentDocxService: BailDocumentDocxService) {}

  @Post(":id/document-docx")
  async genererDocument(
    @Param("id") id: string,
    @Body() dto: GenererDocumentBailDocxDto,
    @Res() res: Response
  ): Promise<void> {
    const { buffer, champsManquantsEnergie } = await this.bailDocumentDocxService.genererDocumentBailDocx(id, dto);
    res.set({
      "Content-Type": MIME_DOCX,
      "Content-Disposition": `attachment; filename="bail-${id}.docx"`,
      // Mentions de performance énergétique générées avec une marque "[À
      // COMPLÉTER]" (décision Jimmy, 2026-10-04) : le document est produit
      // quand même, cet en-tête permet au frontend d'avertir avant
      // d'ouvrir/livrer le fichier — voir exposedHeaders (main.ts) et
      // locataires/api.ts (genererDocumentBail) côté desktop.
      ...(champsManquantsEnergie.length > 0 ? { "X-Champs-Energie-Manquants": champsManquantsEnergie.join(",") } : {})
    });
    res.send(buffer);
  }
}
