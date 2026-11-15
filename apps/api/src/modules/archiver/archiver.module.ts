import { Module } from '@nestjs/common';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { ArchiverService } from './archiver.service';
import { S3ArchiveAdapter } from './s3-archive.adapter';
import { ArchiverController } from './archiver.controller';
import { ARCHIVE_STORAGE_PORT } from './ports/archive-storage.port';

@Module({
  imports: [PrismaModule],
  controllers: [ArchiverController],
  providers: [
    S3ArchiveAdapter,
    {
      provide: ARCHIVE_STORAGE_PORT,
      useExisting: S3ArchiveAdapter,
    },
    ArchiverService,
  ],
  exports: [ArchiverService, S3ArchiveAdapter, ARCHIVE_STORAGE_PORT],
})
export class ArchiverModule {}
