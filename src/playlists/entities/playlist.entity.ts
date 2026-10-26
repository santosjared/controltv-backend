import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { PlaylistItem } from './playlist-item.entity.js';

@Entity({ name: 'playlists' })
export class Playlist {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 150 }) nombre: string;
  @Column({ type: 'text', nullable: true }) descripcion: string | null;
  @OneToMany(() => PlaylistItem, (item) => item.playlist, {
    cascade: true,
  })
  items: Relation<PlaylistItem[]>;
  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
