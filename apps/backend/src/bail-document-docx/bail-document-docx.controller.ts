import { Body, Controller, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { BailDocumentDocxService } from "./bail-document-docx.service";
import { GenererDocumentBailDocxDto } from "./dto/generer-document-bail-docx.dto";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

@UseGuards(JwtAuthGuard)
@Controller("baux")
export class BailDocumentDocxController {
  constructor(private readonly bailDocumentDocxService: BailDocumentDocxService) {}

  @Post(":id/document-docx")
  async genererDocument(
    @Param("id") id: string,
    @Body() dto: GenererDocumentBailDocxDto,
    @Res() res: Response
  ): Promise<void> {
    const buffer = await this.bailDocumentDocxService.genererDocumentBailDocx(id, dto);
    res.set({
      "Content-Type": MIME_DOCX,
      "Content-Disposition": `attachment; filename="bail-${id}.docx"`
    });
    res.send(buffer);
  }
}
