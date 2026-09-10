import { PartialType } from '@nestjs/mapped-types';
import { CreateEstadoTvDto } from './create-estado-tv.dto.js';
export class UpdateEstadoTvDto extends PartialType(CreateEstadoTvDto) {}
