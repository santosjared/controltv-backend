import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'permissions' })
@Index('UQ_permissions_clave_activa', ['clave'], {
  unique: true,
  where: '"deleted" = false',
})
export class Permission {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 100 }) clave: string;
  @Column({ type: 'varchar', length: 150, default: '' }) nombre: string;
  @Column({ type: 'varchar', length: 80, default: '' }) modulo: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) descripcion:
    string | null;
  @Column({ type: 'boolean', default: false }) deleted: boolean;
}
