import { Module } from '@nestjs/common';
import { SalasModule } from './salas/salas.module.js';
import { TvsModule } from './tvs/tvs.module.js';
import { ContenidosModule } from './contenidos/contenidos.module.js';
import { EstadosTvModule } from './estados-tv/estados-tv.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'postgres'),
        password: config.get('DB_PASSWORD', 'postgres'),
        database: config.get('DB_DATABASE', 'tvcontrol'),
        autoLoadEntities: true,
        synchronize: config.get('DB_SYNCHRONIZE', 'false') === 'true',
      }),
    }),
    SalasModule,
    TvsModule,
    ContenidosModule,
    EstadosTvModule,
  ],
})
export class AppModule {}
