# Power IaC validation: `KiroManStack`

Template: `infra/cdk.out/KiroManStack.template.json`, from `npm run synth` with `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` unset. The stack is never deployed.

## How the power was used

The `aws-infrastructure-as-code` power is installed at `~/.kiro/powers/installed/aws-infrastructure-as-code/`. Its MCP server (`awslabs.aws-iac-mcp-server` 1.0.26, started with the power's own `uvx awslabs.aws-iac-mcp-server@latest` command, AWS credentials removed from its environment) was driven over stdio with the MCP TypeScript SDK client from this repo, because the agent session that built the stack did not have the power's tools attached directly. The tools called were:

| Tool | Input | Used for |
|---|---|---|
| `cdk_best_practices` | none | Design rules applied in `infra/lib/kiro-man-stack.ts` (cited in its header comment) |
| `search_cdk_documentation` | "HttpApi addStage throttle rateLimit burstLimit createDefaultStage" | Stage `throttle` settings (aws_apigatewayv2 README, aws-cdk-lib 2.272.0) |
| `search_cdk_documentation` | "S3BucketOrigin withOriginAccessControl CloudFront Distribution" | OAC origin and bucket policy (aws_cloudfront_origins README) |
| `search_cdk_documentation` | "NodejsFunction logGroup bundling externalModules projectRoot depsLockFilePath" | `entry` must sit under `projectRoot`, which defaults to the lock file's directory (NodejsFunctionProps) |
| `validate_cloudformation_template` | the synthesized template | cfn-lint (results below) |
| `check_cloudformation_template_compliance` | the synthesized template | cfn-guard with the power's bundled `aws-security` rule set (results below) |

The reproducible CLI path is `npm run cfn-lint` (`scripts/cfn-lint.sh`, cfn-lint 1.57.1 through uvx), which writes `docs/cfn-lint-report.txt`. Its findings match the power's cfn-lint run exactly. The cfn-guard CLI is not installed on this machine, so the Guard results come only from the power.

## Best-practice guidance applied

| `cdk_best_practices` guidance | In the stack |
|---|---|
| Prefer L2 constructs | Only L2 constructs (`Table`, `NodejsFunction`, `HttpApi`, `Bucket`, `Distribution`, `BucketDeployment`, `LogGroup`) |
| Use generated names, not physical names | No `tableName`, `bucketName` or `functionName`; the Lambda reads `TABLE_NAME` from its environment |
| Make decisions at synthesis time | The `dist/` check is a TypeScript `if` with a synth warning, not a CloudFormation Condition |
| Define removal policies and log retention | Table, bucket and both log groups are `DESTROY`; both log groups keep one week |
| Least privilege through grants | `table.grant(fn, 'dynamodb:PutItem', 'dynamodb:Query')`: only the two calls the handler makes |
| Encryption, SSL, blocked public access | S3-managed encryption, `enforceSSL`, `BlockPublicAccess.BLOCK_ALL`, CloudFront OAC, `REDIRECT_TO_HTTPS` |
| Unit test the template, keep stateful logical IDs stable | `infra/test/stack.test.ts` (13 assertions, including `ScoresTable6CB35494` and `SiteBucket397A1860`) |
| Separate stateful and stateless stacks | Not followed: the spec fixes one demo stack (overview section 7.4) whose stateful resources are all `DESTROY`, so there is no data to protect from stack replacement |
| CDK Nag (optional, needs user consent) | Not added; it would be a new dependency the specs don't list. cfn-lint and Guard cover the security review |

## cfn-lint (`validate_cloudformation_template`)

Result: `is_valid: true`, 0 errors, 3 warnings, 0 informational.

| Rule | Resource | Finding | Resolution |
|---|---|---|---|
| W3005 | `ScoresFn81466544` (scores Lambda) | `DependsOn` on `ScoresFnServiceRole0499CD21` is already implied by `Fn::GetAtt` on `Role` | Justified. CDK emits the explicit `DependsOn` on the role and its default policy so the IAM policy exists before the function is created; the redundant edge on the role is harmless |
| W3005 | `CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F` | Same, for the auto-delete provider role | Justified. CDK-generated custom resource provider for `autoDeleteObjects`; same pattern |
| W3005 | `CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C81C01536` | Same, for the BucketDeployment handler role | Justified. CDK-generated singleton handler; same pattern |

## cfn-guard (`check_cloudformation_template_compliance`)

Result: `VIOLATIONS_FOUND`, 7 errors, rule set `aws-security`. The tool reports the resource as "Unknown" for every finding. Running the power's bundled rules through its own `guardpycfn` module identifies them as `SiteBucket397A1860` (the only bucket), its policy `SiteBucketPolicy3AC1D0F8`, and the BucketDeployment role policy.

| Rule | Resource | Resolution |
|---|---|---|
| `S3_BUCKET_DEFAULT_LOCK_ENABLED` | `SiteBucket397A1860` | Justified. The bucket holds only the static game build, which every deployment overwrites from `dist/`. Object Lock would block those overwrites and `autoDeleteObjects` |
| `S3_BUCKET_LOGGING_ENABLED` | `SiteBucket397A1860` | Justified. Nobody reads the bucket directly: CloudFront is the only reader (OAC) and public access is blocked. Access logging would need a second bucket that a synth-only arcade demo doesn't need |
| `S3_BUCKET_NO_PUBLIC_RW_ACL` | `SiteBucket397A1860` | Justified (false positive). The rule checks `AccessControl != 'PublicReadWrite'` and fails when the property is absent. The bucket sets no ACL, new buckets default to ACLs disabled (bucket owner enforced), and all four Block Public Access flags are on (asserted in `stack.test.ts`). Setting `AccessControl: Private` was tried: it cleared this rule but cfn-lint then raised W3045 (legacy property), so it was reverted |
| `S3_BUCKET_REPLICATION_ENABLED` | `SiteBucket397A1860` | Justified. The content can be rebuilt from the repo at any time; cross-region replication adds a second bucket and role for no recovery benefit |
| `S3_BUCKET_SSL_REQUESTS_ONLY` | `SiteBucketPolicy3AC1D0F8` | Justified (false positive). The policy has the deny statement (`Effect: Deny`, `Action: s3:*`, `Condition: {Bool: {aws:SecureTransport: "false"}}`) from `enforceSSL: true`. Guard's message is "PathAwareValues are not comparable String, bool": CDK writes the condition value as the string `"false"`, and the rule compares it with the boolean `false`. IAM evaluates both forms the same way. `stack.test.ts` asserts the statement |
| `S3_BUCKET_VERSIONING_ENABLED` | `SiteBucket397A1860` | Justified. Every deployment replaces the whole build and the source of truth is git; old versions would only accumulate storage |
| `IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE` | `CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756CServiceRoleDefaultPolicy88902FDF` | Justified. The only `Resource: "*"` in the template is `cloudfront:CreateInvalidation` / `cloudfront:GetInvalidation` in the role that CDK generates for `BucketDeployment` (used once per deployment to invalidate `/*`). The application's own role (`ScoresFnServiceRoleDefaultPolicyF3B5BF18`) is scoped to the table ARN and two actions |

## Fixed while validating

- The BucketDeployment handler received a CDK-managed log group with 731-day retention and `DeletionPolicy: Retain` (from the `@aws-cdk/aws-lambda:useCdkManagedLogGroup` feature flag in `cdk.json`). The stack now passes an explicit `DeploySiteLogs` log group (one week, `DESTROY`). `stack.test.ts` asserts that every log group in the template keeps one week and is deleted with the stack.
- `stack.test.ts` synthesizes with the `cdk.json` feature flags, so the tested template is the one `cdk synth` writes and these tools validated.
