import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
export class CreateTvDto {
  @IsUUID() sala_id: string;
  @IsString() @MaxLength(100) tv_id: string;
  @IsString() @MaxLength(100) nombre: string;
  @IsOptional() @IsDateString() ultimo_contacto?: string;
}
