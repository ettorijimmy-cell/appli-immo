import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@Controller("contacts")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateContactDto) {
    return this.contactsService.create(req.user!.sub, dto);
  }

  @Get()
  findAll() {
    return this.contactsService.findAll();
  }

  // Carnet de contacts : liste unifiée locataires + garants (lecture
  // seule) + contacts professionnels — voir ContactsService.findAllUnifie.
  @Get("unifie")
  findAllUnifie() {
    return this.contactsService.findAllUnifie();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.contactsService.findById(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Patch(":id/archiver")
  archive(@Param("id") id: string) {
    return this.contactsService.archive(id);
  }
}
