/**
 * `KiroManStack` (overview §7.4, LB-8): HTTP API → Lambda (replays the shared engine) → DynamoDB, plus
 * S3 + CloudFront hosting for the game. Synth only; this project never deploys it.
 *
 * Written while consulting the `aws-infrastructure-as-code` power (awslabs.aws-iac-mcp-server):
 * - `cdk_best_practices`: L2 constructs only, generated physical names, decisions at synth time in code
 *   (the `dist/` check below, not CloudFormation Conditions), explicit removal policies and log
 *   retention, encryption + SSL + blocked public access on buckets, least-privilege grants, and unit
 *   tests on the template (infra/test/stack.test.ts) including stable logical IDs for stateful resources.
 * - `search_cdk_documentation`: aws_apigatewayv2 README (stage `throttle` settings),
 *   aws_cloudfront_origins README (`S3BucketOrigin.withOriginAccessControl` creates the OAC and the
 *   bucket policy), aws_lambda_nodejs NodejsFunctionProps (`entry` must sit under `projectRoot`;
 *   `projectRoot` defaults to the lock file's directory, so it is set explicitly to the repo root).
 * The best-practices advice to split stateful resources into their own stack is not followed: the spec
 * fixes one demo stack whose resources are all `DESTROY` (see docs/power-iac-validation.md).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** The repo root: esbuild must resolve `../../src/{engine,shared,content,leaderboard}` from the Lambda. */
export const REPO_ROOT = path('../../');
export const DEFAULT_SITE_DIR = path('../../dist');
export const MAX_BODY_BYTES = 131072;

export interface KiroManStackProps extends StackProps {
  /** The built game (`npm run build`). Deployed with `config.json` when it exists at synth time. */
  readonly siteDir?: string;
}

export class KiroManStack extends Stack {
  constructor(scope: Construct, id: string, props: KiroManStackProps = {}) {
    super(scope, id, props);
    const siteDir = props.siteDir ?? DEFAULT_SITE_DIR;

    // Single partition "GLOBAL", sort key zeroPad10(score)#createdAt#id: a reverse Query returns the top 10.
    const table = new Table(this, 'ScoresTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // demo project (README)
    });

    // Explicit log group with retention (not the deprecated `logRetention` custom resource).
    const logGroup = new LogGroup(this, 'ScoresFnLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Bundled by the local esbuild (an infra devDependency), so synth never falls back to Docker. The
    // Node 22 runtime ships SDK v3, so `@aws-sdk/*` stays external.
    const fn = new NodejsFunction(this, 'ScoresFn', {
      entry: path('../lambda/scores-handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      projectRoot: REPO_ROOT,
      depsLockFilePath: path('../package-lock.json'),
      memorySize: 1024, // about 0.6 vCPU: a worst-case 108000-tick replay stays well inside the timeout
      timeout: Duration.seconds(15),
      logGroup,
      environment: { TABLE_NAME: table.tableName, MAX_BODY_BYTES: String(MAX_BODY_BYTES) },
      bundling: { minify: true, sourceMap: true, target: 'node22', externalModules: ['@aws-sdk/*'] },
    });
    // Least privilege: the handler only writes single items and runs one Query.
    table.grant(fn, 'dynamodb:PutItem', 'dynamodb:Query');

    const api = new HttpApi(this, 'ScoresApi', {
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
      },
    });
    // Throttling is applied at the stage, before any compute cost (LB-8.1). The construct id is not
    // 'Default': CDK drops 'Default' path segments from logical IDs, which would collide with the API's.
    api.addStage('DefaultStage', { stageName: '$default', autoDeploy: true, throttle: { rateLimit: 10, burstLimit: 20 } });
    // Both routes reach the Lambda, so `core.handle` owns 404/405; API Gateway answers CORS preflight.
    const integration = new HttpLambdaIntegration('ScoresIntegration', fn);
    api.addRoutes({ path: '/scores', methods: [HttpMethod.ANY], integration });
    api.addRoutes({ path: '/{proxy+}', methods: [HttpMethod.ANY], integration });

    const bucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const distribution = new Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Decided at synth time: deploy the build when it exists, otherwise warn and keep synth working.
    // config.json is runtime config, so one build works offline and online without a rebuild.
    if (existsSync(siteDir)) {
      new BucketDeployment(this, 'DeploySite', {
        // Its handler would otherwise get a CDK-managed log group retained for two years.
        logGroup: new LogGroup(this, 'DeploySiteLogs', { retention: RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY }),
        destinationBucket: bucket,
        sources: [Source.asset(siteDir), Source.jsonData('config.json', { apiUrl: api.apiEndpoint })],
        distribution,
        distributionPaths: ['/*'],
      });
    } else {
      Annotations.of(this).addWarningV2(
        'kiro-man:siteNotBuilt',
        `No site build at ${siteDir}; run "npm run build" before synth to include the BucketDeployment.`,
      );
    }

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
