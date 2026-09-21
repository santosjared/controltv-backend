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

const mediaUploadInterceptor = FileInterceptor('file', {
  dest: TRANSFER_DIR,
  limits: {
    fileSize: MAX_MEDIA_SIZE,
    files: 1,
    // Permite enviar tv_ids como JSON o como campos multipart repetidos.
    fields: 102,
    parts: 103,
    fieldSize: 4096,
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
});

@Controller('tvs')
export class TransfersController {
  constructor(
    private readonly transfers: TransfersService,
    private readonly tvs: TvsService,
    private readonly gateway: TvsGateway,
  ) {}

  @Post('transferencias')
  @UseInterceptors(mediaUploadInterceptor)
  async uploadMany(
    @Body() body: { tv_ids?: unknown; ids?: unknown; senderId?: unknown },
    @UploadedFile() file?: MediaFile,
  ) {
    if (!file) throw new BadRequestException('file es obligatorio');
    try {
      const tvIds = this.parseTvIds(body.tv_ids ?? body.ids);
      const senderId = this.normalizeSenderId(body.senderId);
      const tvs = await Promise.all(
        tvIds.map((tvId) => this.tvs.findOne(tvId)),
      );
      const transfers = await this.transfers.createMany(
        tvs.map((tv) => tv.tv_id),
        senderId,
        file,
      );
      for (const transfer of transfers)
        this.gateway.notifyMedia(transfer.tv_id, transfer);
      return { transferencias: transfers };
    } finally {
      await rm(file.path, { force: true });
    }
  }

  @Post(':tv_id/transferencias')
  @UseInterceptors(mediaUploadInterceptor)
  async upload(
    @Param('tv_id') tv_id: string,
    @Body('senderId') senderId: unknown,
    @UploadedFile() file?: MediaFile,
  ) {
    if (!file) throw new BadRequestException('file es obligatorio');
    try {
      const normalizedSenderId = this.normalizeSenderId(senderId);
      const tv = await this.tvs.findOne(tv_id);
      const transfer = this.transfers.create(
        tv.tv_id,
        normalizedSenderId,
        file,
      );
      this.gateway.notifyMedia(tv.tv_id, transfer);
      return transfer;
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }
  }

  @Get(':tv_id/transferencias/:id/archivo')
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

  @Post(':tv_id/transferencias/:id/confirmar')
  confirm(
    @Param('tv_id') tv_id: string,
    @Param('id') id: string,
    @Query('token') token: unknown,
  ) {
    return this.transfers.confirm(tv_id, id, token);
  }

  private parseTvIds(value: unknown): string[] {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadRequestException('tv_ids debe ser un array JSON');
      }
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.length > 100 ||
      parsed.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new BadRequestException(
        'tv_ids debe contener entre 1 y 100 IDs válidos',
      );
    }
    return parsed.map((id) => (id as string).trim());
  }

  private normalizeSenderId(value: unknown): string | null {
    // Multipart serializa null como texto; también se permite omitir el campo.
    if (value == null || value === 'null' || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || value.length > 100)
      throw new BadRequestException(
        'senderId debe ser null o un texto de hasta 100 caracteres',
      );
    return value.trim();
  }
}
