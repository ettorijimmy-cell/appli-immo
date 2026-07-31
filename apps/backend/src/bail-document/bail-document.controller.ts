import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { BailDocumentService } from "./bail-document.service";
import { GenererDocumentBailDto } from "./dto/generer-document-bail.dto";

@Controller("baux")
export class BailDocumentController {
  constructor(private readonly bailDocumentService: BailDocumentService) {}

  @Post(":id/document")
  async genererDocument(
    @Param("id") id: string,
    @Body() dto: GenererDocumentBailDto,
    @Res() res: Response
  ): Promise<void> {
    const buffer = await this.bailDocumentService.genererDocumentBail(id, dto);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="bail-${id}.pdf"`
    });
    res.send(buffer);
  }
}
