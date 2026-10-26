import {
  Controller,
  Get,
  Next,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { PlaybackService } from './playback.service.js';

@Controller('tvs')
export class PlaybackController {
  constructor(private readonly playback: PlaybackService) {}

  @Public()
  @Get(':tv_id/reproduccion/:id/archivo')
  async download(
    @Param('tv_id') tvId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: unknown,
    @Query('token') token: unknown,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    const file = await this.playback.getFile(tvId, id, expires, token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(file.nombre);
    res.download(file.path, file.nombre, (error) => {
      if (!error) return;
      if (['ECONNABORTED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      next(
        !res.headersSent && (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new NotFoundException('El archivo ya no está disponible')
          : error,
      );
    });
  }
}
