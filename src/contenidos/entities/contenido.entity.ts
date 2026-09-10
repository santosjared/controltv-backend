import {
  Check,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { EstadoTv } from '../../estados-tv/entities/estado-tv.entity.js';

export enum TipoContenido {
  VIDEO = 'VIDEO',
  IMAGEN = 'IMAGEN',
}

@Entity({ name: 'contenidos' })
@Check(`"tipo" IN ('VIDEO', 'IMAGEN')`)
export class Contenido {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 150 }) nombre: string;
  @Column({ type: 'varchar', length: 20 }) tipo: TipoContenido;
  @Column({ type: 'text' }) url: string;
  @Column({ type: 'bigint', nullable: true }) tamano_bytes: string | null;
  @OneToMany(() => EstadoTv, (estado) => estado.contenido)
  estados_tv: Relation<EstadoTv[]>;
}
