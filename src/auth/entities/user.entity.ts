import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Role } from './role.entity.js';

export enum EstadoUsuario {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 150 }) nombre_completo: string;
  @Column({ type: 'varchar', length: 30, unique: true })
  cedula_identidad: string;
  @Column({ type: 'varchar', length: 80, unique: true }) usuario: string;
  @Column({ type: 'varchar', length: 300, select: false })
  password_hash: string;
  @Column({ type: 'varchar', length: 20, default: EstadoUsuario.ACTIVO })
  estado: EstadoUsuario;
  @Column({ type: 'boolean', default: false }) deleted: boolean;
  @Column({ type: 'timestamp', nullable: true }) ultimo_acceso: Date | null;

  @ManyToMany(() => Role, { eager: true })
  @JoinTable({
    name: 'users_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Relation<Role[]>;

  @CreateDateColumn({ type: 'timestamp' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamp' }) updated_at: Date;
}
