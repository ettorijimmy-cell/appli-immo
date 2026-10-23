import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { TropDeTentativesConnexionException } from "./trop-de-tentatives-connexion.exception";

// Scopé à POST /auth/login via @UseFilters() sur ce seul handler (jamais
// un filtre global) : seul cet endpoint pose un Retry-After.
@Catch(TropDeTentativesConnexionException)
export class TropDeTentativesConnexionFilter implements ExceptionFilter {
  catch(exception: TropDeTentativesConnexionException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.header("Retry-After", String(exception.retryAfterSeconds));
    response.status(HttpStatus.TOO_MANY_REQUESTS).json(exception.getResponse());
  }
}
