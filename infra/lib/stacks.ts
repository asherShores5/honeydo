import * as path from "node:path";
import {
  CfnOutput, Duration, RemovalPolicy, Stack, type StackProps,
  aws_appsync as appsync,
  aws_budgets as budgets,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export const APP_DOMAIN = "honeydo.ashershores.com";
/** Previous domain; its cert is kept for one deploy so the cross-region export can be released. */
const OLD_DOMAIN: string | undefined = undefined;
export const ZONE = { hostedZoneId: "Z03837921G383RCR4HG5", zoneName: "ashershores.com" };
export const USERNAMES = ["asher", "aubyn"];
const BUDGET_EMAIL = "asher.shores5@gmail.com";
const ROOT = path.join(__dirname, "..", "..");

/** CloudFront certificates must live in us-east-1. */
export class CertStack extends Stack {
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", ZONE);
    this.certificate = new acm.Certificate(this, "HoneydoCert", {
      domainName: APP_DOMAIN,
      validation: acm.CertificateValidation.fromDns(zone),
    });
    if (OLD_DOMAIN) {
      new acm.Certificate(this, "Cert", { domainName: OLD_DOMAIN, validation: acm.CertificateValidation.fromDns(zone) });
    }
  }
}

interface AppStackProps extends StackProps {
  certificate: acm.ICertificate;
}

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // ---- data ----
    const table = new dynamodb.TableV2(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: "ttl",
      globalSecondaryIndexes: [
        {
          indexName: "GSI1",
          partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "updatedAt", type: dynamodb.AttributeType.NUMBER },
        },
      ],
    });

    // ---- auth: 2 admin-created users, password once, then passkeys ----
    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "aubi-honey",
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      signInPolicy: { allowedFirstAuthFactors: { password: true, passkey: true } },
      passkeyRelyingPartyId: APP_DOMAIN,
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
      passwordPolicy: { minLength: 16, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const client = userPool.addClient("Web", {
      authFlows: { user: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ---- API ----
    const fn = new nodejs.NodejsFunction(this, "ApiFn", {
      entry: path.join(ROOT, "api", "src", "handler.ts"),
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName, ALLOWED_USERNAMES: USERNAMES.join(",") },
      bundling: { minify: true, sourceMap: true, format: nodejs.OutputFormat.ESM, target: "node22" },
      logGroup: new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    table.grantReadWriteData(fn);

    const api = new appsync.GraphqlApi(this, "Api", {
      name: "aubi-honey",
      definition: appsync.Definition.fromFile(path.join(ROOT, "schema", "schema.graphql")),
      authorizationConfig: {
        defaultAuthorization: { authorizationType: appsync.AuthorizationType.USER_POOL, userPoolConfig: { userPool } },
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR, retention: logs.RetentionDays.TWO_WEEKS },
    });
    const ds = api.addLambdaDataSource("ApiDs", fn);
    for (const field of ["me", "snapshot", "completions"]) ds.createResolver(`Q${field}`, { typeName: "Query", fieldName: field });
    for (const field of ["putItem", "completeItem", "undoCompletion", "putTag", "deleteTag", "putProfile"]) {
      ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });
    }
    // Private items never fan out to the partner (SPEC §4.5), except the one change that makes a
    // shared item Private: it names the partner in removedFor so their phone drops it live.
    // Mirrored by deliveredTo() in api/src/testing/harness.ts; keep the two in step.
    api.addNoneDataSource("None").createResolver("SubItems", {
      typeName: "Subscription",
      fieldName: "onItemChange",
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromInline(`
import { util, extensions } from "@aws-appsync/utils";
export function request() { return { payload: null }; }
export function response(ctx) {
  extensions.setSubscriptionFilter(util.transform.toSubscriptionFilter({
    or: [
      { visibility: { in: ["shared", "private:" + ctx.identity.sub] } },
      { removedFor: { contains: ctx.identity.sub } },
    ],
  }));
  return null;
}`),
    });

    // ---- web hosting ----
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", ZONE);
    const bucket = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const region = this.region;
    const headers = new cloudfront.ResponseHeadersPolicy(this, "Headers", {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            `connect-src 'self' https://*.appsync-api.${region}.amazonaws.com wss://*.appsync-realtime-api.${region}.amazonaws.com https://cognito-idp.${region}.amazonaws.com`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
          ].join("; "),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: false },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN },
      },
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: headers,
      },
      defaultRootObject: "index.html",
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) })),
      domainNames: [APP_DOMAIN],
      certificate: props.certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    new s3deploy.BucketDeployment(this, "Deploy", {
      destinationBucket: bucket,
      sources: [
        s3deploy.Source.asset(path.join(ROOT, "web", "dist")),
        s3deploy.Source.jsonData("config.json", {
          region,
          userPoolId: userPool.userPoolId,
          clientId: client.userPoolClientId,
          graphqlUrl: api.graphqlUrl,
          usernames: USERNAMES,
        }),
      ],
      // Vite assets are content-hashed; no-cache just forces cheap revalidation of index/config.
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ["/*"],
    });
    for (const [name, Rec] of [["A", route53.ARecord], ["AAAA", route53.AaaaRecord]] as const) {
      new Rec(this, `Alias${name}`, {
        zone,
        recordName: APP_DOMAIN,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    // ---- cost guardrail ----
    new budgets.CfnBudget(this, "Budget", {
      budget: {
        budgetName: "aubi-honey-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 5, unit: "USD" },
        costFilters: { TagKeyValue: ["user:app$aubi-honey"] },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80 },
          subscribers: [{ subscriptionType: "EMAIL", address: BUDGET_EMAIL }],
        },
        {
          notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100 },
          subscribers: [{ subscriptionType: "EMAIL", address: BUDGET_EMAIL }],
        },
      ],
    });

    new CfnOutput(this, "Url", { value: `https://${APP_DOMAIN}` });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "GraphqlUrl", { value: api.graphqlUrl });
  }
}

export const GITHUB_REPO = "asherShores5/honeydo";
/** Immutable owner/repo IDs; GitHub's OIDC `sub` now embeds them (owner@id/repo@id). */
const GITHUB_REPO_WITH_IDS = "asherShores5@71547146/honeydo@1427388015";
export const DEPLOY_BRANCH = "prod";

/**
 * GitHub Actions → AWS via OIDC (no stored keys). The role can only assume the CDK bootstrap
 * roles, and only workflows running on the prod branch of this repo can assume it.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const provider = new iam.OpenIdConnectProvider(this, "GitHub", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    const role = new iam.Role(this, "DeployRole", {
      roleName: "honeydo-github-deploy",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": [GITHUB_REPO_WITH_IDS, GITHUB_REPO].map(
            (r) => `repo:${r}:ref:refs/heads/${DEPLOY_BRANCH}`,
          ),
        },
      }),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );
    new CfnOutput(this, "DeployRoleArn", { value: role.roleArn });
  }
}
