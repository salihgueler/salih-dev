---
title: "AI-Guided AWS Deployment for Your Dart Backend Applications"
description: "Use Amazon Q Developer CLI to containerize and deploy Dart backend applications to AWS, covering REST APIs and WebSocket workloads."
pubDate: "2025-05-14T08:57:26Z"
category: "Dart"
tags: ["cloud","backend","flutter","aws"]
hero:
  src: "https://salih.dev/images/blog/2485246-ai-guided-aws-deployment-for-your-dart-backend-applications-4g3a.webp"
  alt: "Cover image for AI-Guided AWS Deployment for Your Dart Backend Applications"
  credit: "DEV Community"
  creditUrl: "https://dev.to/salihgueler/ai-guided-aws-deployment-for-your-dart-backend-applications-4g3a"
aiSummary: "Use Amazon Q Developer CLI to containerize and deploy Dart backend applications to AWS, covering REST APIs and WebSocket workloads."
originalUrl: "https://dev.to/salihgueler/ai-guided-aws-deployment-for-your-dart-backend-applications-4g3a"
sources: [{"name":"DEV Community","url":"https://dev.to/salihgueler/ai-guided-aws-deployment-for-your-dart-backend-applications-4g3a"}]
draft: false
---

Dart's potential for backend development has gained a lot of attention. While Dart's official [shelf](https://pub.dev/packages/shelf) library has been the traditional solution for backend development, there has been other solutions to enable full-stack Dart applications. Projects like [Serverpod](https://serverpod.dev/) and [Dart Frog](https://dartfrog.vgv.dev/) are expanding the ecosystem, making it easier than ever to build complete applications using Dart on both frontend and backend.

In the age of AI, you ask many of your questions to AI and deploying backend as a Flutter developer can be a question that you might ask as well. In this blog post, you will see how you can deploy your Dart backends to AWS with the help of [Amazon Q Developer on CLI](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el).

You can check out the source-code for the project over [GitHub](https://bit.ly/4i0UxnB) to start with. Besides that you have to have an AWS Account to deploy over AWS and for using Amazon Q Developer on CLI (or IDE) you should have [Builder ID](https://community.aws/builderid?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) and install Q developer CLI by following the [official documentation](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el).

## Deploying REST APIs

First, we have to start by running the Amazon Q Developer on our CLI. At any point in your project, you can type 'q' and it will show a window for you to interact.

![A terminal window displaying the welcome screen for Amazon Q, a command-line interface tool. The screen shows a stylized "Amazon Q" logo in cyan, a "Did you know?" tip about the /usage command, and shortcuts for help and navigation at the bottom. The window title indicates it's running in a zsh terminal on macOS.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/b3kqyybv2gsr1q7rwg92.jpg)

If you want to limit the context, you can navigate to the root folder of your project. Next, you need to tell the Q CLI what you want from it.

> I want to deploy the hello.dart file in the backend folder. I don't know anything about AWS. All I know is, hello.dart is an application for a REST API. Show me the simplest, fastest and cheapest way to deploy this dart backend app over AWS. 

![A terminal window showing a conversation with Amazon Q. The user asks about deploying a hello.dart file as a REST API to AWS. Q responds by starting to help, using the fs_read tool to check the backend directory structure at /Users/msalihg/Desktop/full-stack-dart/backend. The operation completes in 0.0 seconds, and Q begins to check the bin directory.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/6jxjxa7g66g9qf4u8b9f.jpg)

When you run this prompt, the Q CLI analyzes your project, locates the backend file you want to deploy, and recommends the best deployment method.

![A terminal window showing Amazon Q creating a Dockerfile for a Dart application. The code displays step 1 of the deployment process, where Q writes a Dockerfile at the project foldeer. The Dockerfile contents show instructions for building a Docker image using dart:stable as the base image and including commands for setting up the working directory, copying files, and running dart pub get commands.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3wo53qi5upo5wgpkr6sa.jpg)

The Q CLI also explains why this deployment method works best.

![ A terminal window displaying instructions for deploying to AWS App Runner. The text includes an 8-step process for deployment using the AWS Console, followed by four key benefits of using AWS App Runner (Simplicity, Cost-effectiveness, Auto-scaling, and Managed service). The screen ends with estimated costs, showing AWS App Runner starts at approximately $5/month for the smallest instance.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/rneimlgu7p0ge4rwmo8y.jpg)

Next, the Q CLI creates the necessary deployment files. You can choose between supervised development or allow automated deployment with minimal intervention.

![A terminal window showing the continuation of a Dockerfile configuration. The code displays lines 4-21 in green text, containing Docker instructions for copying files, running Dart commands, setting up the working directory, configuring port 8080, and starting the application. At the bottom, there's a prompt asking to trust the action with options [y/n/t].](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/a6e4yg0dwf0wo440eo7v.jpg)

## Deploying to AWS

After the Q CLI generates the necessary files, you will find a Dockerfile among them.

```dockerfile
FROM dart:stable AS build

WORKDIR /app
COPY pubspec.* ./
RUN dart pub get
COPY . .
RUN dart pub get --offline

# Build a minimal serving image
FROM dart:stable
COPY --from=build /app /app
WORKDIR /app

# Make sure the application listens on port 8080
ENV PORT=8080

# Install dependencies in the final image
RUN dart pub get

# Start the application
CMD ["dart", "bin/hello.dart"]

# Expose the port
EXPOSE 8080
```

Docker creates a virtual environment that contains all necessary dependencies. 

You can choose between AI-guided automated deployment or manual deployment following step-by-step instructions. For the REST API deployment, you will focus on the manual instructions first.

First, you need to create a repository in Amazon Elastic Container Registry (ECR) to store your Docker container image.

![AWS Console interface showing the "Create private repository" page in Amazon ECR. The page displays general settings including a repository name field with "full-stack-dart/hello" entered, and image tag mutability options where "Mutable" is selected. Below, there's an encryption settings section with a warning that encryption settings cannot be changed after repository creation. The top navigation bar shows various AWS services including Bedrock, Amplify, CloudWatch, and others.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/rtjcoj32spw4eda5fxc9.jpg)

After naming the repository and keeping the default settings, click 'Create.' Amazon ECR will display commands for building and pushing the container.

![AWS Console modal window showing "Push commands for full-stack-dart/hello" with two tabs: "macOS / Linux" (selected) and "Windows". The window displays step-by-step instructions for pushing Docker images to ECR, including authentication commands, Docker build instructions, and image tagging steps. Each command is shown in a copyable code block format. The instructions include links to additional documentation and a note about AWS CLI version requirements. A close button appears in the top-right corner.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/df8mcmf0ftk2zulof1m7.jpg)

After pushing the container, proceed to AWS App Runner to run it. Create a service and assign the container as a resource to this service.

![AWS Console interface for creating an App Runner service. The page shows "Source and deployment" options with a three-step process on the left. The main section displays choices for "Repository type" (Container registry selected) and "Provider" (Amazon ECR selected). Options for source code repository and Amazon ECR Public are also visible but not selected. The top navigation bar shows various AWS services including Bedrock, Amplify, CloudWatch, and others.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3rv3hq5l7a8whfojsus5.jpg)

Next, enter a name and keep the default settings.

![AWS App Runner service configuration page showing service settings. The form includes fields for service name (set to "full-stack-dart-hello-service"), dropdown menus for Virtual CPU (1 vCPU selected) and Virtual memory (2 GB selected). Below are sections for optional runtime environment variables with an "Add environment variable" button, IAM policy templates for secrets, and a Port configuration. The page indicates no environment variables are currently configured and allows up to 50 items to be added.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3xian0r3iyw1w3fq3r2u.jpg)

The backend is now ready for deployment.

## Troubleshooting

When you deploy your backend, the initial deployment may fail with the following information:

![AWS Console Application logs interface showing an error message from a Dart execution on May 5, 2025. The interface includes options to search logs, load more events, download, and view in CloudWatch. A single log entry displays "exec /usr/lib/dart/bin/dart: exec format error" with timestamp 07:00:05 AM.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/ohs1bpzb51y0c0agzooq.jpg)

An advantage of working with AI is the ability to provide context for assistance with deployment or troubleshooting potential issues.

![Terminal window showing a debugging conversation about Docker "exec format error". The response explains that this error occurs when running Docker containers built for different CPU architectures. It includes a solution using the docker buildx command to build for linux/amd64 platform, with code examples in green text against a dark background.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/6x0i9fnfrycejjywmcm4.jpg)

In this case, the system shows how to deploy containers to different architectures.

The solution requires rebuilding with multi-architecture support and updating the image in Amazon ECR:

```bash

# If you don't have buildx set up:
# Create a new builder instance
docker buildx create --name mybuilder --use

# Build with the correct platform
docker buildx build --platform=linux/amd64 --load -t hello .

# Tag and push
docker tag hello:latest AWS_USER_ID.dkr.ecr.us-east-1.amazonaws.com/full-stack-dart/hello:latest
docker push AWS_USER_ID.dkr.ecr.us-east-1.amazonaws.com/full-stack-dart/hello:latest
```

After rebuilding the project, the deployment completes successfully.

![AWS Console showing the App Runner service page for "full-stack-dart-hello-service". The interface displays deployment logs with timestamps from May 5, 2025, showing the start of a deployment process with ECR image details. Navigation tabs include Logs, Activity, Metrics, Observability, Configuration, and Custom domains, with a green success message banner at the top indicating successful service update.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/gevy38fc544fji3aix6l.jpg)

Also, the endpoint works as expected:

![A web browser window displaying a simple white page with the text "Hello Salih" in large, monospaced font. The URL bar shows a link to an AWS App Runner service.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/cc77w7h2t0mlc2tsoqhy.jpg)

## Deploying Dart Backends with Websockets

The shared codebase contains the original implementation: a game with an emoji counter. It uses WebSockets and provides real-time updates to each listener.

Now, let's switch the deployment approach from manual instructions to automated deployment using Q CLI, with human involvement limited to testing the results.

Run the following prompt on Q CLI: 

>  Hello I want you to deploy the dart websocket backend under serverpod folder to the cheapest and fastest AWS option. I am not knowledgable with AWS so I want you to take care of necessary permissions, create necessary files and execute the deployment until it is successful. Make sure to use a service supporting websockets and service can be deployed through CLI. Also, make sure whatever way you deploy is in line with the deployment environment. E.g. if you are deploying to Linux, make sure to cover Linux related deployments. Test and make sure the connection is established before you complete the request. Once all is done and successful, document the steps and results to a markdown file. 

Q CLI analyzes the project, examines the implementation, generates a solution, and provides detailed explanations.

![A terminal window showing deployment notes with two sections labeled "Fast" and "Good". Under "Fast", there are 4 numbered points describing Elastic Beanstalk deployment features including quick deployment process, Docker containerization, zero infrastructure setup, and automated WebSocket configuration. Under "Good", there is 1 point about production-ready setup with security features. The text is displayed in white on a dark background with section headers in purple.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/25eb8klyqlskf90jbjd0.jpg)

Like before, hen prompted, enter 't' to authorize full AI implementation. After deployment, the system displays an execution summary:

![A terminal window showing a completion message and a summary of a deployment documentation file. The window displays a list of 9 topics covered in the documentation, including deployment overview, prerequisites, project analysis, AWS setup, Elastic Beanstalk configuration and deployment, testing, web interface improvements, and conclusion. Below the list, there's a message confirming successful deployment on AWS Elastic Beanstalk using a t2.micro instance, noting it as a cost-effective solution. The text is in white on a dark background with a green "Completed in 0.0s" message at the top.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/4lmqwjbtx9le2ra4d4iw.jpg)

As you have seen in the previous example, Dart backends lack direct deployment solutions. While AWS offers multiple services for containerized applications, Q CLI selected Elastic Beanstalk for these reasons:

- It supports websockets
- It's like having a hosting service specifically designed for web applications
- It handles a lot of the complex infrastructure setup automatically
- It's part of the AWS Free Tier, so it's cost-effective for our project

Think of Elastic Beanstalk as a service that takes your code and automatically sets up everything needed to run it online.

### Containerizing Our App with Docker

Before deploying, Q CLI needed to package your app in a way that ensures it runs the same way everywhere. It updated your Dockerfile like the following:

```dockerfile
FROM dart:stable AS build

WORKDIR /app
COPY pubspec.* ./
RUN dart pub get
COPY . .
RUN dart pub get --offline

# Build a minimal serving image
FROM dart:stable
COPY --from=build /app /app
WORKDIR /app

# Make sure the application listens on port 8080
ENV PORT=8080

# Install dependencies in the final image
RUN dart pub get

# Start the application
CMD ["dart", "bin/server.dart"]

# Expose the port
EXPOSE 8080
```

This Dockerfile:
1. Starts with a base Dart environment
2. Copies our app code
3. Installs dependencies
4. Sets up the command to run our server
5. Exposes port 8080 so the outside world can connect

### Setting Up Network Security

Next, Q CLI created what AWS calls a **Security Group** - think of it as a virtual firewall that controls what traffic can reach our server:

```
✅ HTTP (port 80) - For regular web traffic
✅ HTTPS (port 443) - For secure web traffic
✅ WebSocket (port 8080) - For our real-time connections
```

This ensures that only the types of connections you expect can reach our server, helping to keep it secure.

### Configuring WebSockets for Production

WebSockets are a bit trickier to set up in production than regular HTTP endpoints. They require special configuration to maintain long-lived connections.

Q CLI created a special configuration file for Nginx (the web server that sits in front of our application). This configuration tells Nginx how to handle WebSocket connections properly. The key parts are:
- Setting up the `/ws` path to handle WebSocket protocol upgrades
- Configuring proper headers for WebSocket connections
- Setting a long read timeout so connections don't drop prematurely

### Deployment Process

With everything configured, Q CLI deployed your app using the Elastic Beanstalk CLI:

1. **Initialized the application** - This creates the basic configuration
2. **Created the environment** - This provisions the actual server
3. **Deployed the code** - This uploads and runs your application

Behind the scenes, AWS:
1. Created a virtual machine (EC2 instance)
2. Set up Docker on that machine
3. Built your Docker container
4. Started your Dart server
5. Configured the network so it's accessible from the internet

### What This Means for You as a Frontend Developer

Now that the backend is deployed, here's what you need to know:

1. **WebSocket Connection**: Update your frontend code to connect to `ws://dart-emoji-backend-env.PROJECT-ID.us-east-1.elasticbeanstalk.com/ws` instead of localhost

2. **API Format**: The message format remains the same:
   - To send a reaction: `{"type": "reaction", "emoji": "👍"}`
   - You'll receive: `{"type": "counts", "counts": {"👍": 1, "❤️": 0, ...}}`

3. **Real-time Updates**: Multiple users can now connect simultaneously from anywhere in the world, and all will see reactions in real-time

The best part? You don't need to worry about managing the server, scaling, or any of the backend infrastructure. It's all handled automatically by AWS Elastic Beanstalk.

## Testing the Deployed Endpoint

Go to the _websocket_service.dart_ file and update the `getWebSocketUrl` function to return your deployed URL and run the application:

::youtube{id="1yYjjXk68pg" title="AI-Guided AWS Deployment for Your Dart Backend Applications video 1"}

## Cleaning Up

If you are doing this as part of an experiment, make sure to delete the deleted resources. You can ask Q CLI to "clean up the deployed resources".

Make sure you also check the deployed services and the deletions happened successfully. 

## Summing up

AI-guided deployment offers powerful capabilities for Dart backend applications with Amazon Q Developer. While experience with AWS and containers enables custom workflow creation, starting with Q CLI to deploy backends provides a quicker and efficient path to successful Dart backend implementation.

To learn more about it, I challenge you to do more by doing one (or all) of the following:

- Try to deploy the Serverpod backend with the same prompts
- Try to deploy your Frontend with the guidance of Q CLI
- Ask more complex questions about pricing :) 

Make sure to check out the Amazon Q CLI [docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) as well as the [Amazon Q on IDE](https://aws.amazon.com/q/developer/build/?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) to make the most out of your AWS experience for your full stack experiences.
