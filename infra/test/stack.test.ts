import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KiroManStack } from '../lib/kiro-man-stack';

let siteDir: string;
let template: Template;
let noSite: KiroManStack;

/** Same feature flags as `cdk synth` (cdk.json context), so the tested template is the synthesized one. */
const CONTEXT = (JSON.parse(readFileSync(fileURLToPath(new URL('../cdk.json', import.meta.url)), 'utf8')) as {
  context: Record<string, unknown>;
}).context;
const newApp = () => new App({ context: CONTEXT });

beforeAll(() => {
  siteDir = mkdtempSync(join(tmpdir(), 'kiroman-site-'));
  writeFileSync(join(siteDir, 'index.html'), '<!doctype html><title>KIRO-MAN</title>');
  template = Template.fromStack(new KiroManStack(newApp(), 'KiroManStack', { siteDir }));
  noSite = new KiroManStack(newApp(), 'KiroManStack', { siteDir: join(siteDir, 'missing') });
});

afterAll(() => rmSync(siteDir, { recursive: true, force: true }));

describe('KiroManStack', () => {
  it('HTTP API $default stage is throttled at 10 rps, burst 20, and auto-deploys', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Stage', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 },
    });
  });

  it('routes ANY /scores and ANY /{proxy+} to the same Lambda integration', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 2);
    template.resourceCountIs('AWS::ApiGatewayV2::Integration', 1);
    const integrationId = Object.keys(template.findResources('AWS::ApiGatewayV2::Integration'))[0];
    for (const routeKey of ['ANY /scores', 'ANY /{proxy+}']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        Target: { 'Fn::Join': ['', ['integrations/', { Ref: integrationId }]] },
      });
    }
  });

  it('API Gateway answers CORS preflight (origin *, GET/POST/OPTIONS, content-type)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: {
        AllowOrigins: ['*'],
        AllowMethods: Match.arrayEquals(['GET', 'POST', 'OPTIONS']),
        AllowHeaders: ['content-type'],
      },
    });
  });

  it('DynamoDB table is on-demand with pk/sk string keys and is destroyed with the stack', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      Properties: {
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: Match.arrayWith([
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ]),
      },
      DeletionPolicy: 'Delete',
    });
  });

  it('scores Lambda: nodejs22.x, 1024 MB, 15 s, env, explicit log group', () => {
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0];
    const logGroupId = Object.keys(template.findResources('AWS::Logs::LogGroup')).find((id) => id.startsWith('ScoresFnLogs'));
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      MemorySize: 1024,
      Timeout: 15,
      Environment: { Variables: Match.objectLike({ TABLE_NAME: { Ref: tableId }, MAX_BODY_BYTES: '131072' }) },
      LoggingConfig: { LogGroup: { Ref: logGroupId } },
    });
  });

  it('every log group (scores Lambda, site deployment) keeps one week and is destroyed with the stack', () => {
    const groups = template.findResources('AWS::Logs::LogGroup');
    expect(Object.keys(groups).sort()).toEqual([expect.stringMatching(/^DeploySiteLogs/), expect.stringMatching(/^ScoresFnLogs/)]);
    for (const g of Object.values(groups)) {
      expect(g).toMatchObject({ Properties: { RetentionInDays: 7 }, DeletionPolicy: 'Delete' });
    }
  });

  it('the Lambda may only PutItem and Query the table', () => {
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::Table'))[0] as string;
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: ['dynamodb:PutItem', 'dynamodb:Query'],
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
          },
        ],
      },
    });
  });

  it('site bucket is private, encrypted and SSL-only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Action: 's3:*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  it('CloudFront reaches the bucket through Origin Access Control and redirects to HTTPS', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({ OriginAccessControlOriginType: 's3', SigningBehavior: 'always' }),
    });
    const oacId = Object.keys(template.findResources('AWS::CloudFront::OriginAccessControl'))[0];
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
        Origins: [Match.objectLike({ OriginAccessControlId: { 'Fn::GetAtt': [oacId, 'Id'] } })],
      }),
    });
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
  });

  it('deploys the site build with a config.json when the build exists', () => {
    template.resourceCountIs('Custom::CDKBucketDeployment', 1);
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      SourceObjectKeys: Match.arrayWith([Match.stringLikeRegexp('\\.zip$')]),
      DistributionPaths: ['/*'],
    });
    // Source.jsonData fills config.json's apiUrl with the API endpoint at deploy time through SourceMarkers.
    const apiId = Object.keys(template.findResources('AWS::ApiGatewayV2::Api'))[0];
    const deployment = Object.values(template.findResources('Custom::CDKBucketDeployment'))[0] as {
      Properties: { SourceMarkers: unknown[] };
    };
    expect(JSON.stringify(deployment.Properties.SourceMarkers)).toContain(
      JSON.stringify({ 'Fn::GetAtt': [apiId, 'ApiEndpoint'] }),
    );
  });

  it('without a build: no BucketDeployment and a synth warning instead', () => {
    Template.fromStack(noSite).resourceCountIs('Custom::CDKBucketDeployment', 0);
    Annotations.fromStack(noSite).hasWarning('/KiroManStack', Match.stringLikeRegexp('No site build at .*npm run build'));
  });

  it('outputs ApiUrl, SiteUrl and TableName', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs).sort()).toEqual(['ApiUrl', 'SiteUrl', 'TableName']);
  });

  it('stateful resources keep stable logical IDs', () => {
    expect(Object.keys(template.findResources('AWS::DynamoDB::Table'))).toEqual(['ScoresTable6CB35494']);
    expect(Object.keys(template.findResources('AWS::S3::Bucket'))).toEqual(['SiteBucket397A1860']);
  });
});
