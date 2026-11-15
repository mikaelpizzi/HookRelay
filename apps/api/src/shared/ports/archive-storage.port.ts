import { Readable } from 'stream';

export interface UploadArchiveResult {
  eTag: string;
}

export interface ArchiveStoragePort {
  /**
   * Ensures the target bucket exists, creating it if necessary.
   */
  ensureBucketExists(): Promise<void>;

  /**
   * Uploads an archived payload (buffer or stream) to cold storage under the given key.
   */
  uploadArchive(
    key: string,
    bufferOrStream: Buffer | Uint8Array | Readable,
  ): Promise<UploadArchiveResult>;

  /**
   * Downloads an archived payload from cold storage.
   */
  getArchive(key: string): Promise<Buffer>;
}

export const ARCHIVE_STORAGE_PORT = Symbol('ARCHIVE_STORAGE_PORT');
