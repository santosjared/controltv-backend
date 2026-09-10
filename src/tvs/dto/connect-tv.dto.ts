import { IsIP, IsString, MaxLength } from 'class-validator';

export class ConnectTvDto {
  @IsIP() ip: string;
  @IsString() @MaxLength(50) model: string;
  @IsString() @MaxLength(100) version_android: string;
  @IsString() @MaxLength(100) connectionId: string;
}
