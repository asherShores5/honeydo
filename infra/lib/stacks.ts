import * as path from "node:path";
import {
  CfnOutput, CustomResource, Duration, RemovalPolicy, Stack, type StackProps,
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
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
  custom_resources as cr,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

export const APP_DOMAIN = "honeydo.ashershores.com";
/** Previous domain; its cert is kept for one deploy so the cross-region export can be released. */
const OLD_DOMAIN: string | undefined = undefined;
export const ZONE = { hostedZoneId: "Z03837921G383RCR4HG5", zoneName: "ashershores.com" };
export const USERNAMES = ["asher", "aubyn"];
const BUDGET_EMAIL = "asher.shores5@gmail.com";
/**
 * Web Push VAPID key pair, created on the first deploy by the VapidKeys custom resource in AppStack
 * (CloudFormation can't create a SecureString) and never overwritten. The public key goes to the
 * client in config.json; only the Notifier role and the VapidKeys function (for crash recovery)
 * can read the private one.
 */
export const VAPID_PARAMS = { private: "/aubi-honey/vapid/private", public: "/aubi-honey/vapid/public" };
const ROOT = path.join(__dirname, "..", "..");

/** Settings every Lambda here shares: bundled from the monorepo, Node 22 on ARM, two-week logs. */
function lambdaFn(
  scope: Construct,
  id: string,
  props: { entry: string; format: nodejs.OutputFormat; sourceMap?: boolean } & Omit<nodejs.NodejsFunctionProps, "entry" | "bundling" | "logGroup">,
) {
  const { entry, format, sourceMap, ...rest } = props;
  return new nodejs.NodejsFunction(scope, id, {
    entry: path.join(ROOT, "api", "src", entry),
    projectRoot: ROOT,
    depsLockFilePath: path.join(ROOT, "package-lock.json"),
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    bundling: { minify: true, sourceMap, format, target: "node22" },
    logGroup: new logs.LogGroup(scope, `${id.replace(/Fn$/, "")}Logs`, { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    ...rest,
  });
}

/** ARNs of the two VAPID parameters. */
function vapidParamArns(stack: Stack) {
  return [VAPID_PARAMS.private, VAPID_PARAMS.public].map((name) => `arn:aws:ssm:${stack.region}:${stack.account}:parameter${name}`);
}

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
  /** The role the Notifier Lambda runs as (m4/04); it reads the VAPID private key to sign pushes. */
  readonly notifierRole: iam.Role;

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
    const fn = lambdaFn(this, "ApiFn", {
      entry: "handler.ts",
      format: nodejs.OutputFormat.ESM,
      sourceMap: true,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName, ALLOWED_USERNAMES: USERNAMES.join(",") },
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
    for (const field of [
      "putItem", "completeItem", "undoCompletion", "putTag", "deleteTag", "putProfile",
      "putPushSubscription", "deletePushSubscription",
      // Not in any @aws_subscribe list: the partner must never learn when I read Activity.
      "markActivitySeen",
    ]) {
      ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });
    }
    // Subscription filters run on one None data source.
    const none = api.addNoneDataSource("None");
    // Notes and Comments fan out only to Members who can see the envelope's visibility. Mirrored
    // by visibilityDeliveredTo() in api/src/testing/harness.ts; keep the two in step.
    const VISIBILITY_FILTER = appsync.Code.fromInline(`
import { util, extensions } from "@aws-appsync/utils";
export function request() { return { payload: null }; }
export function response(ctx) {
  extensions.setSubscriptionFilter(util.transform.toSubscriptionFilter({
    visibility: { in: ["shared", "private:" + ctx.identity.sub] },
  }));
  return null;
}`);

    // ---- Comments (M2) ----
    ds.createResolver("Qcomments", { typeName: "Query", fieldName: "comments" });
    ds.createResolver("MaddComment", { typeName: "Mutation", fieldName: "addComment" });
    // A Comment fans out under its stamp (its Item's Visibility when written), so a Comment on a
    // Private item reaches its owner only.
    none.createResolver("SubComments", {
      typeName: "Subscription", fieldName: "onCommentChange", runtime: appsync.FunctionRuntime.JS_1_0_0, code: VISIBILITY_FILTER,
    });

    // Private items never fan out to the partner (SPEC §4.5), except the one change that makes a
    // shared item Private: it names the partner in removedFor so their phone drops it live.
    // Mirrored by deliveredTo() in api/src/testing/harness.ts; keep the two in step.
    none.createResolver("SubItems", {
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

    // ---- Fridge Notes (m2/02) ----
    for (const field of ["postNote", "pinNote", "setNoteExpiry"]) {
      ds.createResolver(`M${field}`, { typeName: "Mutation", fieldName: field });
    }
    // Notes are all shared today, but they fan out through the same Visibility filter so a Private
    // Note could never reach the partner.
    none.createResolver("SubNotes", {
      typeName: "Subscription", fieldName: "onNoteChange", runtime: appsync.FunctionRuntime.JS_1_0_0, code: VISIBILITY_FILTER,
    });

    // ---- Note to Task (m2/03) ---- Fans out through SubNotes like the other Note mutations.
    ds.createResolver("MmarkNoteTasked", { typeName: "Mutation", fieldName: "markNoteTasked" });

    // ---- notifier (M4) ----
    // The Notifier Lambda runs as this role. It and the key-provisioning function (VapidKeysFn,
    // below) are the only principals granted the VAPID private key; the API Lambda gets no SSM access.
    // The key is a SecureString under the AWS-managed aws/ssm key, which SSM decrypts for any
    // principal allowed GetParameter, so no kms:Decrypt statement is needed.
    const notifierRole = (this.notifierRole = new iam.Role(this, "NotifierRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    }));
    notifierRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: vapidParamArns(this),
      }),
    );
    // Bundled as CJS: web-push is CommonJS and calls require("crypto"), which ESM output can't do.
    const notifier = lambdaFn(this, "NotifierFn", {
      entry: "notifier.ts",
      format: nodejs.OutputFormat.CJS,
      sourceMap: true,
      memorySize: 256,
      timeout: Duration.seconds(60),
      role: notifierRole,
      // No reserved concurrency: claim-before-send already makes overlapping runs send each push
      // once, and a reserve fails to deploy on accounts with a low concurrency limit.
      environment: {
        TABLE_NAME: table.tableName,
        VAPID_PRIVATE_PARAM: VAPID_PARAMS.private,
        VAPID_PUBLIC_PARAM: VAPID_PARAMS.public,
        VAPID_SUBJECT: `mailto:${BUDGET_EMAIL}`,
      },
    });
    // Only what notifier.ts calls: Query to load, UpdateItem to claim, DeleteItem to prune.
    table.grant(notifier, "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem");
    // A UTC cron at :00/:15/:30/:45 lines runs up with the HH:MM Slots (a rate would start at
    // deploy time, e.g. :07). Pacific offsets are whole hours, so UTC quarter-hours work all year.
    new scheduler.Schedule(this, "NotifierEvery15", {
      description: "Honey Do Notifier: overdue Dings and Handoffs",
      schedule: scheduler.ScheduleExpression.cron({ minute: "0/15" }),
      target: new schedulerTargets.LambdaInvoke(notifier, { retryAttempts: 0 }),
    });

    // ---- VAPID key pair (M4): created by the deploy, never overwritten, kept when the stack goes ----
    // Logic and tests in api/src/vapid.ts. The private key stays in SSM: the resource returns only
    // the public key, which config.json reads from it (a GetAtt, so the keys exist before config.json).
    const vapidFn = lambdaFn(this, "VapidKeysFn", {
      entry: "vapidKeysProvider.ts",
      format: nodejs.OutputFormat.ESM,
      timeout: Duration.seconds(30),
      environment: { VAPID_PRIVATE_PARAM: VAPID_PARAMS.private, VAPID_PUBLIC_PARAM: VAPID_PARAMS.public },
    });
    // GetParameter covers the private key too, on purpose: vapid.ts reads it only to rebuild a
    // missing public key after a crash between its two writes. Narrowing it would kill that path.
    // No KMS statement: the AWS-managed aws/ssm key's own policy lets SSM encrypt and decrypt for
    // any principal in the account that is allowed the SSM call.
    vapidFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: vapidParamArns(this),
      }),
    );
    const vapidKeys = new CustomResource(this, "VapidKeys", {
      resourceType: "Custom::VapidKeys",
      serviceToken: new cr.Provider(this, "VapidKeysProvider", {
        onEventHandler: vapidFn,
        logGroup: new logs.LogGroup(this, "VapidKeysProviderLogs", { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
      }).serviceToken,
    });
    // The Notifier (and its schedule, which references it) only comes up once the keys exist.
    notifier.node.addDependency(vapidKeys);

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
          // From the VapidKeys resource, not an SSM reference: CloudFormation resolves SSM references
          // before any resource runs, so on the first deploy the parameter wouldn't exist yet.
          vapidPublicKey: vapidKeys.getAttString("publicKey"),
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
