import {
  IsIP,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RegisterTvDto {
  @Matches(/^TV-[0-9A-F]{8}-[0-9A-F]{3}$/)
  tv_id: string;

  @IsString()
  @MaxLength(100)
  model: string;

  @IsString()
  @MaxLength(100)
  version_android: string;

  @IsIP()
  ip: string;

  @IsString()
  @MaxLength(100)
  sala: string;

  @IsString()
  @MaxLength(200)
  ubicacion: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombre?: string;
}
