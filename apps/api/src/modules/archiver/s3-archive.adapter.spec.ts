import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3ArchiveAdapter } from './s3-archive.adapter';

describe('S3ArchiveAdapter', () => {
  let adapter: S3ArchiveAdapter;
  let mockSend: jest.Mock;
  let mockS3Client: S3Client;

  beforeEach(() => {
    mockSend = jest.fn();
    mockS3Client = {
      send: mockSend,
    } as unknown as S3Client;

    adapter = new S3ArchiveAdapter(mockS3Client);
  });

  describe('ensureBucketExists', () => {
    it('should verify existing bucket successfully without creating a new one', async () => {
      mockSend.mockResolvedValueOnce({});

      await adapter.ensureBucketExists();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg).toBeInstanceOf(HeadBucketCommand);
      expect(callArg.input.Bucket).toBe('hookrelay-archives');
    });

    it('should create bucket when HeadBucketCommand throws 404 / NotFound', async () => {
      const notFoundError = new Error('Not Found');
      (notFoundError as any).$metadata = { httpStatusCode: 404 };
      (notFoundError as any).name = 'NotFound';

      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({ Location: '/hookrelay-archives' });

      await adapter.ensureBucketExists();

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(mockSend.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
      expect(mockSend.mock.calls[1][0].input.Bucket).toBe('hookrelay-archives');
    });

    it('should gracefully handle BucketAlreadyOwnedByYou on concurrent creation', async () => {
      const notFoundError = new Error('NoSuchBucket');
      (notFoundError as any).name = 'NoSuchBucket';

      const alreadyExistsError = new Error('Bucket already owned by you');
      (alreadyExistsError as any).name = 'BucketAlreadyOwnedByYou';

      mockSend
        .mockRejectedValueOnce(notFoundError)
        .mockRejectedValueOnce(alreadyExistsError);

      await expect(adapter.ensureBucketExists()).resolves.not.toThrow();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should rethrow unexpected errors during bucket verification', async () => {
      const forbiddenError = new Error('Access Denied');
      (forbiddenError as any).$metadata = { httpStatusCode: 403 };

      mockSend.mockRejectedValueOnce(forbiddenError);

      await expect(adapter.ensureBucketExists()).rejects.toThrow('Access Denied');
    });

    it('should catch error on onModuleInit and log warning without crashing', async () => {
      const err = new Error('Connection refused');
      mockSend.mockRejectedValueOnce(err);

      await expect(adapter.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('uploadArchive', () => {
    it('should upload archive payload and strip enclosing quotes from ETag', async () => {
      mockSend.mockResolvedValueOnce({
        ETag: '"9b10ba0309970c64e6a5c0fa0116b799"',
      });

      const payload = Buffer.from('test archive data');
      const key = 'archives/delivery_attempts/year=2026/month=11/test.jsonl.gz';

      const result = await adapter.uploadArchive(key, payload);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('hookrelay-archives');
      expect(command.input.Key).toBe(key);
      expect(command.input.Body).toBe(payload);
      expect(command.input.ContentType).toBe('application/gzip');
      expect(result).toEqual({ eTag: '9b10ba0309970c64e6a5c0fa0116b799' });
    });

    it('should throw error when S3 response does not contain ETag', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(
        adapter.uploadArchive('test-key', Buffer.from('data')),
      ).rejects.toThrow('missing ETag');
    });

    it('should propagate S3 client errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 upload timeout'));

      await expect(
        adapter.uploadArchive('test-key', Buffer.from('data')),
      ).rejects.toThrow('S3 upload timeout');
    });
  });

  describe('getArchive', () => {
    it('should retrieve archive and return Buffer using transformToByteArray', async () => {
      const content = Buffer.from('decompressed archive content');
      mockSend.mockResolvedValueOnce({
        Body: {
          transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(content)),
        },
      });

      const result = await adapter.getArchive('archives/test.jsonl.gz');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input.Key).toBe('archives/test.jsonl.gz');
      expect(result).toEqual(content);
    });

    it('should retrieve archive using async iterable stream fallback', async () => {
      const content = Buffer.from('streamed buffer data');
      const readableStream = Readable.from([content]);

      mockSend.mockResolvedValueOnce({
        Body: readableStream,
      });

      const result = await adapter.getArchive('archives/stream-test.jsonl.gz');

      expect(result).toEqual(content);
    });

    it('should throw error when Body is null or undefined', async () => {
      mockSend.mockResolvedValueOnce({
        Body: undefined,
      });

      await expect(adapter.getArchive('empty-key')).rejects.toThrow(
        'returned empty body',
      );
    });
  });

  describe('configuration accessors', () => {
    it('should return client and bucket name', () => {
      expect(adapter.getClient()).toBe(mockS3Client);
      expect(adapter.getBucketName()).toBe('hookrelay-archives');
    });
  });
});
