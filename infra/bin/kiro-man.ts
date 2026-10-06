/**
 * CDK app entry (run by `cdk synth` through tsx, see cdk.json). The stack is environment-agnostic (no
 * `env`, no context lookups), so it synthesizes without AWS credentials or bootstrap (LB-8.2).
 * This project is synth only: it is never deployed from here.
 */
import { App } from 'aws-cdk-lib';
import { KiroManStack } from '../lib/kiro-man-stack';

const app = new App();
new KiroManStack(app, 'KiroManStack', {
  description: 'KIRO-MAN: replay-validated score API (HTTP API, Lambda, DynamoDB) and static hosting (S3 + CloudFront).',
});
app.synth();
