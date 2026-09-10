import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import type { Relation } from 'typeorm';
import { Tv } from '../../tvs/entities/tv.entity.js';

@Entity({ name: 'salas' })
export class Sala {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) nombre: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) ubicacion:
    string | null;
  @OneToMany(() => Tv, (tv) => tv.sala) tvs: Relation<Tv[]>;
}
