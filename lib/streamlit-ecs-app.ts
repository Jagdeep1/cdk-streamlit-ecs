import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrdeploy from 'cdk-ecr-deployment';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class StreamlitAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);


    // Create VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: "public-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "private-subnet",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },]
    });

    // Create security group to allow HTTP traffic only
    const securityGroupALB = new ec2.SecurityGroup(this, 'SecurityGroupALB', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow HTTP traffic only',
    })
    securityGroupALB.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))

    const securityGroupECS = new ec2.SecurityGroup(this, 'SecurityGroupECS', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow HTTP traffic only',
    })
    securityGroupECS.addIngressRule(securityGroupALB, ec2.Port.tcp(80))

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,

    });

    // Create ECR repository
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'streamlit-app',
    });

    // Build and push Docker image to ECR
    const image = new DockerImageAsset(this, 'Image', {
      directory: 'app',
      platform: Platform.LINUX_AMD64,
      buildArgs: {
        IMAGE_TAG: 'latest',
        IMAGE_PORT: '8501',
        IMAGE_ARGS: '',
      }
    })

    const ecr_image_push = new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName(image.imageUri),
      dest: new ecrdeploy.DockerImageName(`${cdk.Aws.ACCOUNT_ID}.dkr.ecr.${cdk.Aws.REGION}.amazonaws.com/streamlit-app:latest`),
    });

    // Allow ECS service to write logs to CloudWatch
    const logGroup = new cdk.aws_logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/streamlit-app',
      retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Create task execution role
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ]
    })

    // Create ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole: taskExecutionRole,
    });
    const container = taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromEcrRepository(
        repository
      ),
      memoryLimitMiB: 512,
      cpu: 256,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'streamlit-app',
        logGroup: logGroup,
      })
    });
    container.addPortMappings({
      containerPort: 8501,
    });



    // Create ECS service
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [securityGroupECS],
    });

    // Allow ECS service to access ECR repository
    repository.grantPull(service.taskDefinition.taskRole);
    // Add required permissions to pull image from ECR
    const ecrPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ecr:GetAuthorizationToken', 'ecr:BatchCheckLayerAvailability', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage'],
      resources: [repository.repositoryArn],
    });

    container.taskDefinition.addToTaskRolePolicy(ecrPolicyStatement);
    // Add required permissions to call sagemaker endpoint
    const sagemakerPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sagemaker:InvokeEndpoint'],
      resources: ['arn:aws:sagemaker:us-east-2:775471825946:endpoint/jumpstart-dft-hf-text2text-flan-t5-xxl-bnb-int8', 'arn:aws:sagemaker:us-east-2:775471825946:endpoint/huggingface-pytorch-inference-2023-07-05-16-47-46-761'],
    })
    container.taskDefinition.addToTaskRolePolicy(sagemakerPolicyStatement);

    // Create ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'StreamlitAlb', {
      vpc,
      internetFacing: true,
      securityGroup: securityGroupALB,
    });
    alb.logAccessLogs(
      // s3 bucket for access logs
      new cdk.aws_s3.Bucket(this, 'StreamlitLogsBucket', {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        serverAccessLogsPrefix: 'streamlit-app',
        enforceSSL: true,
      })
    );

    // Create listener
    const listener = alb.addListener('StreamlitListener', {
      port: 80,
    });

    // Create target group
    const targetGroup = listener.addTargets('StreamlitTargetGroup', {
      port: 8501,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/',
      },
    });

    // Add vpc flowlogs to vpc
    const flowLogs = new cdk.aws_ec2.FlowLog(this, 'FlowLogs', {
      resourceType: cdk.aws_ec2.FlowLogResourceType.fromVpc(vpc),
      trafficType: cdk.aws_ec2.FlowLogTrafficType.ALL,
      destination: cdk.aws_ec2.FlowLogDestination.toCloudWatchLogs(
        logGroup
      )
    });

    // Output URL of deployed application
    new cdk.CfnOutput(this, 'StreamlitUrl', {
      value: `http://${alb.loadBalancerDnsName}`,
    });


  }
}
