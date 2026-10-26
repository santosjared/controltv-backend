import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre: string;
  @IsOptional() @IsString() @MaxLength(200) descripcion?: string;
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permission_ids: string[];
}
