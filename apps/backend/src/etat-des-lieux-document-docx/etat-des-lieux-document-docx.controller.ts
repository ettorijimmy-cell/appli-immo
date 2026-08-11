import { Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { EtatDesLieuxDocumentDocxService } from "./etat-des-lieux-document-docx.service";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

@Controller("etats-des-lieux")
export class EtatDesLieuxDocumentDocxController {
  constructor(private readonly etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService) {}

  @Post(":id/document-docx")
  async genererDocument(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const buffer = await this.etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(id);
    res.set({
      "Content-Type": MIME_DOCX,
      "Content-Disposition": `attachment; filename="etat-des-lieux-${id}.docx"`
    });
    res.send(buffer);
  }
}
