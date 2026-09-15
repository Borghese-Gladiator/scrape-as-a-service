import { Client as MinioClient } from 'minio';
import { loadConfig, type AppConfig } from './config.js';

export interface StoragePutResult {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
}

export interface StorageClient {
  ensureBucket(): Promise<void>;
  put(objectKey: string, body: Buffer, contentType: string): Promise<StoragePutResult>;
  getStream(objectKey: string): Promise<NodeJS.ReadableStream>;
  remove(objectKey: string): Promise<void>;
  presignedGetUrl(objectKey: string, expirySeconds?: number): Promise<string>;
}

/** Build the `runs/<run-id>/<filename>` object key. */
export function runObjectKey(runId: string, filename: string): string {
  return `runs/${runId}/${filename}`;
}

class MinioStorageClient implements StorageClient {
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.client = new MinioClient({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
    this.bucket = config.minio.bucket;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async put(objectKey: string, body: Buffer, contentType: string): Promise<StoragePutResult> {
    await this.client.putObject(this.bucket, objectKey, body, body.length, {
      'Content-Type': contentType,
    });
    return { objectKey, contentType, sizeBytes: body.length };
  }

  async getStream(objectKey: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.bucket, objectKey);
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }

  async presignedGetUrl(objectKey: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectKey, expirySeconds);
  }
}

export function getStorage(config: AppConfig = loadConfig()): StorageClient {
  return new MinioStorageClient(config);
}
