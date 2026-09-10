import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { rm } from 'node:fs/promises';
import {
  MAX_MEDIA_SIZE,
  TRANSFER_DIR,
  TransfersService,
} from './transfers.service.js';
import type { MediaFile } from './transfers.service.js';
import { TvsService } from './tvs.service.js';
import { TvsGateway } from './tvs.gateway.js';

@Controller('tvs/:tv_id/transferencias')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly tvs: TvsService,
    private readonly gateway: TvsGateway,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      dest: TRANSFER_DIR,
      limits: {
        fileSize: MAX_MEDIA_SIZE,
        files: 1,
        fields: 1,
        parts: 2,
        fieldSize: 256,
      },
      fileFilter: (_req, file, cb) => {
        const accepted = /^(image|video)\/[a-z0-9.+-]+$/i.test(file.mimetype);
        cb(
          accepted
            ? null
            : new BadRequestException('Solo se permiten imágenes o videos'),
          accepted,
        );
      },
    }),
  )
  async upload(
    @Param('tv_id') tv_id: string,
    @Body('senderId') senderId: unknown,
    @UploadedFile() file?: MediaFile,
  ) {
    if (!file) throw new BadRequestException('file es obligatorio');
    try {
      // Multipart serializa null como texto; también se permite omitir el campo.
      const normalizedSenderId =
        senderId == null || senderId === 'null' || senderId === ''
          ? null
          : senderId;
      if (
        normalizedSenderId !== null &&
        (typeof normalizedSenderId !== 'string' ||
          !normalizedSenderId.trim() ||
          normalizedSenderId.length > 100)
      ) {
        throw new BadRequestException(
          'senderId debe ser null o un texto de hasta 100 caracteres',
        );
      }
      const tv = await this.tvs.findOne(tv_id);
      const transfer = this.transfers.create(
        tv.tv_id,
        normalizedSenderId === null ? null : normalizedSenderId.trim(),
        file,
      );
      this.gateway.notifyMedia(tv.tv_id, transfer);
      return transfer;
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }
  }

  @Get(':id/archivo')
  download(
    @Param('tv_id') tv_id: string,
    @Param('id') id: string,
    @Query('token') token: unknown,
    @Res() res: Response,
  ) {
    const file = this.transfers.get(tv_id, id, token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(file.mimetype);
    res.download(file.path, file.originalname);
  }

  @Post(':id/confirmar')
  confirm(
    @Param('tv_id') tv_id: string,
    @Param('id') id: string,
    @Query('token') token: unknown,
  ) {
    return this.transfers.confirm(tv_id, id, token);
  }
}
