import {
  IsIP,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateTvDto {
  @Matches(/^TV-[0-9A-F]{8}-[0-9A-F]{3}$/)
  tv_id: string;

  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsUUID()
  sala_id: string;

  @IsString()
  @MaxLength(100)
  sala: string;

  @IsString()
  @MaxLength(200)
  ubicacion: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  version_android?: string;

  @IsOptional()
  @IsIP()
  ip?: string;
}
