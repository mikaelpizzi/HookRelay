import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import {
  ArchiveStoragePort,
  UploadArchiveResult,
} from './ports/archive-storage.port';

@Injectable()
export class S3ArchiveAdapter implements ArchiveStoragePort, OnModuleInit {
  private readonly logger = new Logger(S3ArchiveAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Optional() customClient?: S3Client) {
    const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:9297';
    const region = process.env.AWS_REGION || 'us-east-1';
    this.bucket =
      process.env.S3_ARCHIVE_BUCKET ||
      process.env.AWS_S3_ARCHIVE_BUCKET ||
      'hookrelay-archives';

    this.client =
      customClient ||
      new S3Client({
        endpoint,
        region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucketExists();
    } catch (error: any) {
      // Warm-up bucket verification should not prevent API boot if emulator is temporarily offline
      this.logger.warn(
        `Failed to verify or create S3 archive bucket on startup: ${error?.message || error}`,
      );
    }
  }

  async ensureBucketExists(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      this.logger.log(`Cold storage S3 bucket "${this.bucket}" verified.`);
    } catch (error: any) {
      const statusCode =
        error?.$metadata?.httpStatusCode || error?.statusCode || error?.status;
      const isNotFound =
        statusCode === 404 ||
        error?.name === 'NotFound' ||
        error?.name === 'NoSuchBucket';

      if (isNotFound) {
        this.logger.log(
          `Cold storage S3 bucket "${this.bucket}" does not exist. Creating...`,
        );
        try {
          await this.client.send(
            new CreateBucketCommand({
              Bucket: this.bucket,
            }),
          );
          this.logger.log(`Cold storage S3 bucket "${this.bucket}" created.`);
        } catch (createError: any) {
          // Guard against race conditions when multiple nodes bootstrap simultaneously
          if (
            createError?.name === 'BucketAlreadyOwnedByYou' ||
            createError?.name === 'BucketAlreadyExists'
          ) {
            this.logger.log(
              `Cold storage S3 bucket "${this.bucket}" already exists.`,
            );
            return;
          }
          throw createError;
        }
      } else {
        throw error;
      }
    }
  }

  async uploadArchive(
    key: string,
    bufferOrStream: Buffer | Uint8Array | Readable,
  ): Promise<UploadArchiveResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bufferOrStream,
      ContentType: 'application/gzip',
    });

    const response = await this.client.send(command);

    if (!response.ETag) {
      throw new Error(`S3 upload failed: missing ETag for object "${key}"`);
    }

    const eTag = response.ETag.replace(/^"|"$/g, '');
    this.logger.log(`Cold storage archive uploaded: ${key} (ETag: ${eTag})`);

    return { eTag };
  }

  async getArchive(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`S3 object "${key}" returned empty body`);
    }

    // AWS SDK v3 Node runtime provides transformToByteArray on incoming streams
    if (typeof (response.Body as any).transformToByteArray === 'function') {
      const bytes = await (response.Body as any).transformToByteArray();
      return Buffer.from(bytes);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  getClient(): S3Client {
    return this.client;
  }

  getBucketName(): string {
    return this.bucket;
  }
}
