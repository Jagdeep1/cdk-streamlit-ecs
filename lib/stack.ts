import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class StreamlitAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
    });

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
    });

    // Create ECR repository
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'streamlit-app',
    });

    // Build and push Docker image to ECR
    const image = new DockerImageAsset(this, 'Image', {
      directory: 'app',
      buildArgs: {
        IMAGE_TAG: 'latest',
        // IMAGE_NAME: 'streamlit-app',
        // IMAGE_REPO: 'streamlit-app',
        // IMAGE_URI: repository.repositoryUri,
        IMAGE_PORT: '8501',
        IMAGE_ENTRYPOINT: 'streamlit run app/main.py',
        IMAGE_CMD: 'streamlit run app/main.py',
        IMAGE_ARGS: '',
      }
    })

    // const asset = new ecr_assets.DockerImageAsset(this, 'Asset', {
    //   directory: image.directory,
    //   repositoryName: repository.repositoryName,
    // });

    // Create ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });
    const container = taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromEcrRepository(
        repository,
        image.imageUri
      ),
      memoryLimitMiB: 512,
      cpu: 256,
    });
    container.addPortMappings({
      containerPort: 8501,
    });

    // Create ECS service
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
    });

    // Allow ECS service to access ECR repository
    repository.grantPull(service.taskDefinition.taskRole);

    // Allow ECS service to write logs to CloudWatch
    const logGroup = new cdk.aws_logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/streamlit-app',
      retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
  }
}
