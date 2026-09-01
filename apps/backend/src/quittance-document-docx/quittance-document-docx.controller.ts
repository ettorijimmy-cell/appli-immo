import { Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { QuittanceDocumentDocxService } from "./quittance-document-docx.service";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Contrôleur séparé sur le préfixe "paiements", même principe que
// BailDocumentDocxController sur "baux" (module dédié, distinct de
// PaiementsModule) — voir docs/backlog.md, Module Tâches, Étape 4.
@Controller("paiements")
export class QuittanceDocumentDocxController {
  constructor(private readonly quittanceDocumentDocxService: QuittanceDocumentDocxService) {}

  @Post(":id/document-quittance-docx")
  async genererDocument(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const buffer = await this.quittanceDocumentDocxService.genererDocumentQuittanceDocx(id);
    res.set({
      "Content-Type": MIME_DOCX,
      "Content-Disposition": `attachment; filename="quittance-${id}.docx"`
    });
    res.send(buffer);
  }
}
