import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReorderPlaylistDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  item_ids: string[];
}
