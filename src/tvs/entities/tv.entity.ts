import {
  Column,
  Check,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Sala } from '../../salas/entities/sala.entity.js';
import { EstadoTv } from '../../estados-tv/entities/estado-tv.entity.js';

export enum EstadoConexionTv {
  CONECTADO = 'CONECTADO',
  BAJA_SENAL = 'BAJA_SENAL',
  DESCONECTADO = 'DESCONECTADO',
}

@Entity({ name: 'tvs' })
@Check(`"estado_conexion" IN ('CONECTADO', 'BAJA_SENAL', 'DESCONECTADO')`)
export class Tv {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) sala_id: string;
  @Column({ type: 'varchar', length: 100, unique: true }) tv_id: string;
  @Column({ type: 'varchar', length: 100 }) nombre: string;
  @Column({ type: 'varchar', length: 100 }) model: string;
  @Column({ type: 'varchar', length: 100 }) version_android: string;
  @Column({ type: 'varchar', length: 45 }) ip: string;
  @Column({
    type: 'varchar',
    length: 20,
    default: EstadoConexionTv.DESCONECTADO,
  })
  estado_conexion: EstadoConexionTv;
  @Column({ type: 'timestamp', nullable: true }) ultimo_contacto: Date | null;

  @ManyToOne(() => Sala, (sala) => sala.tvs, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sala_id' })
  sala: Relation<Sala>;

  @OneToOne(() => EstadoTv, (estado) => estado.tv)
  estado: Relation<EstadoTv> | null;
}
