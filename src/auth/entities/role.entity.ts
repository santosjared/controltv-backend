import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Permission } from './permission.entity.js';

@Entity({ name: 'roles' })
@Index('UQ_roles_nombre_activo', ['nombre'], {
  unique: true,
  where: '"deleted" = false',
})
export class Role {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 80 }) nombre: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) descripcion:
    string | null;
  @Column({ type: 'boolean', default: false }) deleted: boolean;

  @ManyToMany(() => Permission, { eager: true })
  @JoinTable({
    name: 'roles_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permisos: Relation<Permission[]>;
}
