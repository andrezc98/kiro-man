/**
 * DynamoDB adapter for `ScoreStore` (leaderboard design "DynamoDB key design"). One partition
 * `pk = "GLOBAL"`, sort key `zeroPad10(score)#createdAt#id`, so a reverse Query with `Limit` returns the
 * top N directly, without a scan or GSI. The only module that imports the AWS SDK.
 */
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { normalize } from '../../src/leaderboard/ranking';
import type { ScoreEntry } from '../../src/leaderboard/ranking';
import type { ScoreStore, StoredScore } from './core';

export const PARTITION = 'GLOBAL';

/** `0000012345#2025-01-01T00:00:00.000Z#<uuid>`: lexicographic order equals score order. */
export function sortKey(e: StoredScore): string {
  return `${e.score.toString().padStart(10, '0')}#${e.createdAt}#${e.id}`;
}

export function createDynamoStore(client: Pick<DynamoDBDocumentClient, 'send'>, tableName: string): ScoreStore {
  return {
    async put(e) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: { pk: PARTITION, sk: sortKey(e), initials: e.initials, score: e.score, level: e.level, createdAt: e.createdAt },
          // Ids are fresh UUIDs; this only guards against overwriting an existing item.
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    },
    async top(n): Promise<ScoreEntry[]> {
      const out = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': PARTITION },
          ScanIndexForward: false,
          Limit: n,
        }),
      );
      return normalize(out.Items ?? []).list;
    },
  };
}
