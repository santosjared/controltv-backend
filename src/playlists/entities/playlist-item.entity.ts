import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Playlist } from './playlist.entity.js';
import { Contenido } from '../../contenidos/entities/contenido.entity.js';

@Entity({ name: 'playlist_items' })
@Unique(['playlist_id', 'orden'])
export class PlaylistItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) playlist_id: string;
  @Column({ type: 'uuid' }) contenido_id: string;
  @Column({ type: 'integer' }) orden: number;
  @Column({ type: 'integer', default: 10 }) duracion_segundos: number;

  @ManyToOne(() => Playlist, (playlist) => playlist.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlist_id' })
  playlist: Relation<Playlist>;

  @ManyToOne(() => Contenido, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'contenido_id' })
  contenido: Relation<Contenido>;
}
