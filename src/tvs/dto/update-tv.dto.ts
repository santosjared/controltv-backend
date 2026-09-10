import { PartialType } from '@nestjs/mapped-types';
import { CreateTvDto } from './create-tv.dto.js';
export class UpdateTvDto extends PartialType(CreateTvDto) {}
