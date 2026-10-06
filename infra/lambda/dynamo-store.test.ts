import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { PARTITION, createDynamoStore, sortKey } from './dynamo-store';

type Client = Pick<DynamoDBDocumentClient, 'send'>;

function fakeClient(reply: (cmd: unknown) => unknown) {
  const sent: unknown[] = [];
  const client = {
    send: async (cmd: unknown) => {
      sent.push(cmd);
      return reply(cmd);
    },
  } as unknown as Client;
  return { client, sent };
}

const ENTRY = { initials: 'KIR', score: 1234, level: 2, createdAt: '2025-01-01T00:00:00.000Z', id: 'abc' };

describe('dynamo-store', () => {
  it('sortKey zero-pads the score so lexicographic order is score order', () => {
    expect(sortKey(ENTRY)).toBe('0000001234#2025-01-01T00:00:00.000Z#abc');
    expect(sortKey({ ...ENTRY, score: 10000000 }) > sortKey({ ...ENTRY, score: 9999999 })).toBe(true);
  });

  it('put writes one item in the GLOBAL partition', async () => {
    const { client, sent } = fakeClient(() => ({}));
    await createDynamoStore(client, 'Scores').put(ENTRY);
    expect(sent).toHaveLength(1);
    const cmd = sent[0] as PutCommand;
    expect(cmd).toBeInstanceOf(PutCommand);
    expect(cmd.input).toEqual({
      TableName: 'Scores',
      Item: { pk: PARTITION, sk: '0000001234#2025-01-01T00:00:00.000Z#abc', initials: 'KIR', score: 1234, level: 2, createdAt: ENTRY.createdAt },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
  });

  it('top runs a reverse Query with Limit and returns only valid entries', async () => {
    const items = [
      { pk: 'GLOBAL', sk: 's3', initials: 'AAA', score: 300, level: 3, createdAt: 'x' },
      { pk: 'GLOBAL', sk: 's2', initials: 'b!!', score: 200, level: 1, createdAt: 'x' },
      { pk: 'GLOBAL', sk: 's1', initials: 'CCC', score: 100, level: 1, createdAt: 'x' },
    ];
    const { client, sent } = fakeClient(() => ({ Items: items }));
    const top = await createDynamoStore(client, 'Scores').top(10);
    const cmd = sent[0] as QueryCommand;
    expect(cmd).toBeInstanceOf(QueryCommand);
    expect(cmd.input).toEqual({
      TableName: 'Scores',
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'GLOBAL' },
      ScanIndexForward: false,
      Limit: 10,
    });
    expect(top).toEqual([
      { initials: 'AAA', score: 300, level: 3 },
      { initials: 'CCC', score: 100, level: 1 },
    ]);
  });

  it('top with no Items gives an empty list', async () => {
    const { client } = fakeClient(() => ({}));
    expect(await createDynamoStore(client, 'Scores').top(10)).toEqual([]);
  });

  it('SDK errors propagate so core maps them to 503', async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error('boom'), { name: 'ResourceNotFoundException' });
    });
    const store = createDynamoStore(client, 'Scores');
    await expect(store.top(10)).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
    await expect(store.put(ENTRY)).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
  });
});
