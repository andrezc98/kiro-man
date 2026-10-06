/**
 * Lambda entry point (HTTP API payload format 2.0). Maps the event to `HttpReq` and runs `core.handle`
 * with the real dependencies: DynamoDB, the wall clock, `randomUUID` and JSON-line logging.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_MAX_BODY_BYTES, handle, jsonLogger } from './core';
import type { CoreDeps, HttpReq, HttpRes } from './core';
import { createDynamoStore } from './dynamo-store';

/** The fields of an `APIGatewayProxyEventV2` this handler reads. */
export interface HttpApiEvent {
  rawPath: string;
  body?: string;
  isBase64Encoded: boolean;
  requestContext: { http: { method: string } };
}

export function toHttpReq(event: HttpApiEvent): HttpReq {
  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    body: event.body ?? null,
    isBase64Encoded: event.isBase64Encoded,
  };
}

/** `MAX_BODY_BYTES` must be a positive integer; anything else falls back to 131072. */
export function maxBodyBytesFrom(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
}

let deps: CoreDeps | undefined;

/** Created on the first invocation (and reused while the execution environment stays warm). */
function realDeps(): CoreDeps {
  if (deps) return deps;
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME is not set');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  deps = {
    store: createDynamoStore(client, tableName),
    now: () => new Date().toISOString(),
    uuid: randomUUID,
    log: jsonLogger((line) => console.log(line)),
    maxBodyBytes: maxBodyBytesFrom(process.env.MAX_BODY_BYTES),
  };
  return deps;
}

export const handler = (event: HttpApiEvent): Promise<HttpRes> => handle(toHttpReq(event), realDeps());
