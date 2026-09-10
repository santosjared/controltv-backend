import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Tv } from '../../tvs/entities/tv.entity.js';
import { Contenido } from '../../contenidos/entities/contenido.entity.js';

export enum EstadoReproduccion {
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  DOWNLOADING = 'DOWNLOADING',
  ERROR = 'ERROR',
}

@Entity({ name: 'estados_tv' })
@Check(`"volumen" BETWEEN 0 AND 100`)
@Check(
  `"estado_reproduccion" IN ('PLAYING', 'PAUSED', 'STOPPED', 'DOWNLOADING', 'ERROR')`,
)
export class EstadoTv {
  @PrimaryColumn('uuid') tv_id: string;
  @Column({ type: 'uuid', nullable: true }) contenido_id: string | null;
  @Column({ type: 'varchar', length: 20, default: EstadoReproduccion.STOPPED })
  estado_reproduccion: EstadoReproduccion;
  @Column({ type: 'integer', default: 0 }) posicion_segundos: number;
  @Column({ type: 'smallint', default: 50 }) volumen: number;
  @Column({ type: 'boolean', default: false }) repetir: boolean;
  @UpdateDateColumn({ type: 'timestamp' }) actualizado_en: Date;

  @OneToOne(() => Tv, (tv) => tv.estado, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tv_id' })
  tv: Relation<Tv>;

  @ManyToOne(() => Contenido, (contenido) => contenido.estados_tv, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'contenido_id' })
  contenido: Relation<Contenido> | null;
}
