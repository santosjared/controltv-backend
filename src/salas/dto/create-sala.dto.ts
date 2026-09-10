import { IsOptional, IsString, MaxLength } from 'class-validator';
export class CreateSalaDto {
  @IsString() @MaxLength(100) nombre: string;
  @IsOptional() @IsString() @MaxLength(200) ubicacion?: string;
}
