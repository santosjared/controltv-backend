import { PartialType } from '@nestjs/mapped-types';
import { CreateSalaDto } from './create-sala.dto.js';
export class UpdateSalaDto extends PartialType(CreateSalaDto) {}
