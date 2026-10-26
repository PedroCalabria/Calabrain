/**
 * Object storage (Cloudflare R2 in production, MinIO locally): a private bucket reached only
 * through short-lived presigned URLs. Browsers upload in parts straight to the bucket.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function storageConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set. Copy .env.example to .env and fill it in.`);
    return v;
  };
  return {
    endpoint: need("S3_ENDPOINT"),
    region: env.S3_REGION || "auto",
    bucket: need("S3_BUCKET"),
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "false") === "true",
  };
}

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(config: StorageConfig) {
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // R2 rejects the newer default checksum headers on presigned part uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const Bucket = config.bucket;

  return {
    bucket: Bucket,

    async createMultipart(key: string, contentType: string): Promise<string> {
      const res = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      if (!res.UploadId) throw new Error("storage did not return an upload id");
      return res.UploadId;
    },

    /** Presigned PUT URLs for the given part numbers (1-based). */
    async presignParts(key: string, uploadId: string, partNumbers: number[], expiresIn = 3600) {
      return Promise.all(
        partNumbers.map(async (PartNumber) => ({
          partNumber: PartNumber,
          url: await getSignedUrl(s3, new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber }), { expiresIn }),
        })),
      );
    },

    /** Parts the bucket already holds, so an interrupted upload resends only the rest. */
    async listParts(key: string, uploadId: string): Promise<Part[]> {
      const parts: Part[] = [];
      let marker: string | undefined;
      do {
        const res = await s3.send(
          new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, ...(marker ? { PartNumberMarker: marker } : {}) }),
        );
        parts.push(...(res.Parts ?? []));
        marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
      } while (marker);
      return parts;
    },

    /** Closes the upload with the parts the bucket reports (the browser never needs ETags). */
    async completeMultipart(key: string, uploadId: string): Promise<{ parts: number; size: number }> {
      const parts = (await this.listParts(key, uploadId)).sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
      if (!parts.length) throw new Error("no parts uploaded");
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber!, ETag: p.ETag! })) },
        }),
      );
      return { parts: parts.length, size: parts.reduce((n, p) => n + (p.Size ?? 0), 0) };
    },

    async abortMultipart(key: string, uploadId: string): Promise<void> {
      await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
    },

    /** Short-lived read URL (PDF viewer, video player). */
    presignGet(key: string, expiresIn = 300, opts: { filename?: string; contentType?: string } = {}) {
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ...(opts.filename ? { ResponseContentDisposition: `inline; filename="${opts.filename.replace(/["\\\r\n]/g, "")}"` } : {}),
          ...(opts.contentType ? { ResponseContentType: opts.contentType } : {}),
        }),
        { expiresIn },
      );
    },

    async head(key: string): Promise<{ size: number; contentType?: string } | null> {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0, ...(res.ContentType ? { contentType: res.ContentType } : {}) };
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async download(key: string, path: string): Promise<void> {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!res.Body) throw new Error(`empty body for ${key}`);
      await pipeline(res.Body as Readable, createWriteStream(path));
    },

    async upload(key: string, path: string, contentType: string): Promise<number> {
      const { size } = await stat(path);
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: createReadStream(path), ContentType: contentType, ContentLength: size }),
      );
      return size;
    },

    async putBytes(key: string, body: Uint8Array, contentType: string): Promise<void> {
      await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
    },

    async list(prefix: string): Promise<{ key: string; lastModified: Date | null; size: number }[]> {
      const out: { key: string; lastModified: Date | null; size: number }[] = [];
      let token: string | undefined;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ...(token ? { ContinuationToken: token } : {}) }));
        for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? null, size: o.Size ?? 0 });
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },

    async deleteMany(keys: string[]): Promise<void> {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        if (!chunk.length) continue;
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}
