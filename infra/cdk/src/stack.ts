import { Stack, type StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfront_origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

/**
 * Feature-flag platform — AWS topology per PLAN.md §8.2.
 *
 * This synthesises the resource graph; v1 is synth-only (no deploy from CI).
 * All resources are intentionally sized for a single-tenant, single-AZ
 * starting point — bump instance sizes and turn on Multi-AZ once real load
 * exists.
 */
export class FfpStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ── VPC: public + private subnets, single NAT for v1 cost. ────────────
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ── Secrets: DB credentials, COOKIE_SECRET. ───────────────────────────
    const dbSecret = new secretsmanager.Secret(this, "DbSecret", {
      description: "Admin API Postgres credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "flags" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const cookieSecret = new secretsmanager.Secret(this, "CookieSecret", {
      description: "Admin session cookie signing key",
      generateSecretString: {
        secretStringTemplate: "{}",
        generateStringKey: "value",
        excludePunctuation: true,
        passwordLength: 64,
      },
    });

    // ── RDS Postgres (single-AZ v1). ──────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc, allowAllOutbound: false });
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      allocatedStorage: 20,
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: "flags",
      multiAz: false,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      backupRetention: Duration.days(7),
    });

    // ── ElastiCache Redis (single node v1, pub/sub only — no persistence). ─
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc });
    const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnetGroup", {
      description: "Isolated subnets for Redis",
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });
    const redis = new elasticache.CfnCacheCluster(this, "Redis", {
      cacheNodeType: "cache.t4g.micro",
      engine: "redis",
      engineVersion: "7.1",
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      cacheSubnetGroupName: redisSubnets.ref,
    });
    redis.addDependency(redisSubnets);

    // ── ECR repositories for the two service images. ──────────────────────
    const adminApiRepo = new ecr.Repository(this, "AdminApiRepo", {
      repositoryName: "ffp/admin-api",
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const resolverRepo = new ecr.Repository(this, "ResolverRepo", {
      repositoryName: "ffp/resolver",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── ECS cluster (shared by both services). ────────────────────────────
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const commonEnv = {
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      REDIS_URL: `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`,
    };

    const dbUrlSecret = ecs.Secret.fromSecretsManager(dbSecret, "password");
    const cookieSecretEcs = ecs.Secret.fromSecretsManager(cookieSecret, "value");

    // ── Admin API: ECS Fargate behind an INTERNAL ALB. ────────────────────
    const adminApi = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "AdminApi", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      publicLoadBalancer: false,
      assignPublicIp: false,
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(adminApiRepo, "latest"),
        containerPort: 4000,
        environment: { ...commonEnv, MIGRATE_ON_BOOT: "true" },
        secrets: {
          DB_PASSWORD: dbUrlSecret,
          COOKIE_SECRET: cookieSecretEcs,
        },
      },
    });
    adminApi.targetGroup.configureHealthCheck({ path: "/api/v1/health", healthyHttpCodes: "200" });
    dbSg.addIngressRule(adminApi.service.connections.securityGroups[0]!, ec2.Port.tcp(5432));
    redisSg.addIngressRule(adminApi.service.connections.securityGroups[0]!, ec2.Port.tcp(6379));

    // ── Resolver: ECS Fargate behind a PUBLIC ALB, 2 tasks for HA. ────────
    const resolver = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "Resolver", {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      publicLoadBalancer: true,
      assignPublicIp: false,
      // SSE requires a long-lived idle-stream window.
      idleTimeout: Duration.seconds(120),
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(resolverRepo, "latest"),
        containerPort: 4001,
        environment: { ...commonEnv, SAFETY_POLL_MS: "60000" },
        secrets: {
          DB_PASSWORD: dbUrlSecret,
        },
      },
    });
    resolver.targetGroup.configureHealthCheck({ path: "/health", healthyHttpCodes: "200" });
    // Deregistration delay: give SSE clients time to reconnect to another task
    // when we roll the resolver.
    resolver.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "20");
    // Stickiness OFF — stream endpoints are idempotent so we want load
    // spreading across tasks.
    dbSg.addIngressRule(resolver.service.connections.securityGroups[0]!, ec2.Port.tcp(5432));
    redisSg.addIngressRule(resolver.service.connections.securityGroups[0]!, ec2.Port.tcp(6379));

    // ── Admin UI: private S3 + CloudFront (OAC). ──────────────────────────
    const adminUiBucket = new s3.Bucket(this, "AdminUiBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const adminUiDistribution = new cloudfront.Distribution(this, "AdminUiDistribution", {
      defaultBehavior: {
        origin: cloudfront_origins.S3BucketOrigin.withOriginAccessControl(adminUiBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        // SPA: route 403/404 through to index.html so client-side routing works.
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // ── SDK edge cache: CloudFront fronting the resolver public ALB.
    //    /sdk/resolve is cacheable by (Origin, Authorization) in principle, but
    //    v1 disables caching everywhere — the ALB itself is fine for latency
    //    and we avoid the caching-correctness foot-guns. /sdk/stream MUST NOT
    //    be cached so we pin it to the no-cache policy.
    const resolverOrigin = new cloudfront_origins.LoadBalancerV2Origin(resolver.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    });

    new cloudfront.Distribution(this, "ResolverDistribution", {
      defaultBehavior: {
        origin: resolverOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      additionalBehaviors: {
        "/sdk/stream": {
          origin: resolverOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          compress: false,
        },
      },
    });

    // Surface useful references to the synth output so an operator can wire
    // DNS / ACM / deployment tooling later.
    this.exportValue(adminApi.loadBalancer.loadBalancerDnsName, { name: "AdminApiAlb" });
    this.exportValue(resolver.loadBalancer.loadBalancerDnsName, { name: "ResolverAlb" });
    this.exportValue(adminUiBucket.bucketName, { name: "AdminUiBucket" });
    this.exportValue(adminUiDistribution.distributionDomainName, { name: "AdminUiCdn" });
    this.exportValue(adminApiRepo.repositoryUri, { name: "AdminApiRepo" });
    this.exportValue(resolverRepo.repositoryUri, { name: "ResolverRepo" });
    this.exportValue(db.dbInstanceEndpointAddress, { name: "DbEndpoint" });
  }
}
