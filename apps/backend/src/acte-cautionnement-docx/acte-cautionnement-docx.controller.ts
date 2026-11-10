import { Body, Controller, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { ActeCautionnementDocxService } from "./acte-cautionnement-docx.service";
import { GenererActeCautionnementDocxDto } from "./dto/generer-acte-cautionnement-docx.dto";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

@Controller("garants")
export class ActeCautionnementDocxController {
  constructor(private readonly acteCautionnementDocxService: ActeCautionnementDocxService) {}

  // Acte de cautionnement d'une caution personne physique (.docx, ouvert
  // dans Word côté desktop, jamais archivé). 404 pour un garant d'une autre
  // organisation, 400 pour un garant qui n'est pas une caution personne
  // physique ou un dossier incomplet (champsManquants).
  @Post(":id/acte-cautionnement-docx")
  async genererActe(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenererActeCautionnementDocxDto,
    @Res() res: Response
  ): Promise<void> {
    const buffer = await this.acteCautionnementDocxService.genererActeCautionnementDocx(id, dto);
    res.set({
      "Content-Type": MIME_DOCX,
      "Content-Disposition": `attachment; filename="acte-cautionnement-${id}.docx"`
    });
    res.send(buffer);
  }
}
