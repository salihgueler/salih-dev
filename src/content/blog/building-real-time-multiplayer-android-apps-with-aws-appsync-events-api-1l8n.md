---
title: "Building Real-Time Multiplayer Android Apps with AWS AppSync Events API"
description: "Build a real-time multiplayer Android quiz app with Kotlin and AWS AppSync Events API, including infrastructure, events, and game-state synchronization."
pubDate: "2025-09-03T11:31:29Z"
category: "Mobile"
tags: ["android","aws","kotlin","gamedev"]
hero:
  src: "https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Frdogxnkx4grloyzea6y8.png"
  alt: "Cover image for Building Real-Time Multiplayer Android Apps with AWS AppSync Events API"
  credit: "DEV Community"
  creditUrl: "https://dev.to/aws/building-real-time-multiplayer-android-apps-with-aws-appsync-events-api-1l8n"
aiSummary: "Build a real-time multiplayer Android quiz app with Kotlin and AWS AppSync Events API, including infrastructure, events, and game-state synchronization."
originalUrl: "https://dev.to/aws/building-real-time-multiplayer-android-apps-with-aws-appsync-events-api-1l8n"
draft: false
---

Real-time experiences are essential for modern applications, from collaboration tools to multiplayer games. However, building these experiences traditionally meant managing complex WebSocket connections, handling state synchronization, and maintaining scalable infrastructure. AWS AppSync now offers a solution with its Events API, enabling developers to create interactive multi-user experiences without the burden of managing underlying real-time communication infrastructure.

In this blog post, you'll build QuizSync - a real-time multiplayer quiz app for Android that synchronizes player actions instantly across devices. By following along, you'll learn how to integrate the AWS AppSync Events API into a native Android application for real-time events and implement a real-time data synchronization mechanism while managing the game state across multiple clients.

Before diving into building QuizSync, ensure you have the following prerequisites set up:

**Android Development**

* [Android Studio](https://developer.android.com/studio) (latest stable version)
* Android SDK with minimum [API level 24](https://developer.android.com/studio/intro/update#sdk-manager) (Android 7.0)
* [Kotlin 2.1.0](https://kotlinlang.org/docs/android-overview.html) or higher
* [Gradle 8.0](https://gradle.org/install/) or higher

**AWS Account & Tools**

* [AWS Account](https://aws.amazon.com/free/) with appropriate permissions
* AWS CLI [installed](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) and [configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
* [Node.js](https://nodejs.org/en/download/) 18+ (for AWS CDK)
* [AWS CDK v2](https://docs.aws.amazon.com/cdk/v2/guide/getting-started.html) installed globally (npm install -g aws-cdk)

## AWS AppSync Events API - The Foundation

Before you start diving into the development of the application, you have to understand how the Events API work. [AWS AppSync Events](https://aws.amazon.com/appsync?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) is a fully-managed Pub/Sub service powered by serverless WebSocket APIs. It allows developers to publish and receive messages directly over WebSocket connections, and supports publishing messages over an HTTP endpoint as well. AppSync Events API allows developers to use a single WebSocket connection for both publishing and receiving events, making it easy to develop real-time features and reducing implementation complexity.

![A detailed infographic showing the AWS AppSync Events API workflow in 6 steps. The process flow starts with establishing connections, moves through defining namespaces and channels, subscription setup, event publishing, processing, and distribution. The diagram includes authentication options like API Key, IAM, Cognito, OIDC, and Lambda Authorizer. At the bottom, it highlights key features including serverless architecture, auto-scaling, low latency, security, global support, pay-per-use pricing, and message ordering capabilities.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/h60z01ulerg3h33i8y29.png)

AWS AppSync Events API operates through a six-step process that eliminates traditional WebSocket complexity: 

1. Clients establish WebSocket connections to the service. 
2. Events are organized into hierarchical namespaces (like /chat or /game) containing specific channels (like chat/room1). 
3. Clients subscribe to relevant channels with our simple client side library methods.
4. Events can be published via either HTTP POST requests or directly through the connected WebSocket.
5. Optional backend processing on the service side with handlers to process, filter, and authorize events in real-time. 
6. Events are automatically distributed to all subscribed clients using unicast, multicast, or broadcast patterns. 

The service provides enterprise-grade authentication through five methods (API Key, IAM, Cognito, OIDC, Lambda) and delivers key benefits including serverless operation, automatic scaling, sub-second latency, built-in security, global distribution, pay-per-use pricing, and guaranteed message ordering - all without requiring any infrastructure management.

To simplify client-side development, AWS AppSync Events provides libraries for TypeScript and Kotlin. These client libraries make it easy to:

* Establish WebSocket connections
* Manage subscriptions
* Handle real-time events
* Implement error handling and reconnection logic

In the next section, we'll use these concepts to implement real-time features in our QuizSync application.

## Building the QuizSync Game

QuizSync game follows a modern architecture that cleanly separates concerns across the Android client and AWS AppSync Events API. The system uses AppSync Event API’s real-time event capabilities to enable multiplayer quiz experiences, with structured event channels handling different aspects of gameplay from lobby management to live competition mechanisms.


![An architectural diagram of QuizSync, a real-time multiplayer quiz app. The diagram shows three main sections: Infrastructure as Code (using CDK Stack with TS) at the top, AWS Cloud services (including AppSync Events API, API Key, and CloudWatch Logs) in the middle, and an Android App section built with Jetpack Compose at the bottom. The Android app section details the UI architecture, screens, data components, technologies used, and communication methods. On the left side, there's a list of event channels for quiz game functionality. The system is connected through real-time communication between the cloud services and the Android app.
](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/dbb3bv2ml0bsk5busi3q.png)

### Building the Backend

For building the backend infrastructure, we will use [Cloud Development Kit (CDK)](https://aws.amazon.com/cdk?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el). This way we can create the infrastructure through a programming language, in this case TypeScript. To start with the implementation, create a new folder for your project. 

```bash
mkdir quizsyncbackend
cd quizsyncbackend
```

Afterwards, initialize the CDK project:

What this creates:

* **_bin/_** - Entry point for your CDK application
* **_lib/_** - Your CDK stack definitions
* **_test/_** - Unit tests for your infrastructure
* **_package.json_** - Dependencies and scripts
* **_tsconfig.json_** - TypeScript configuration
* **_cdk.json_** - CDK-specific configuration

Open the entry point file **_bin/quizsyncbackend.ts_** and replace its contents with the following:

```ts
#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { QuizSyncStack } from "../lib/quizsyncbackend-stack";

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext("environment") || "dev";

// Create the QuizSync stack with best practices
const stack = new QuizSyncStack(app, `QuizSyncStack-${environment}`, {
  // Specify the environment for the stack
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },

  // Stack configuration
  environment,
  enableTracing: true,
  logRetentionDays:
    environment === "prod"
      ? cdk.aws_logs.RetentionDays.ONE_MONTH
      : cdk.aws_logs.RetentionDays.ONE_WEEK,

  // Add stack description
  description: `QuizSync Real-time Quiz Application - AppSync Events API Infrastructure (${environment})`,

  // Add tags for resource management
  tags: {
    Project: "QuizSync",
    Environment: environment,
    Purpose: "Production-Ready Implementation",
    ManagedBy: "CDK",
    Version: "2.0",
  },
});
```

The `QuizSyncStack` represents the main building block of our application. When you update **_lib/quizsyncbackend-stack.ts_**, you'll create an AppSync Events API that handles real-time event management. The stack includes API key configuration for authorization, enabling clients to connect, publish, and subscribe to real-time events. For monitoring purposes, the stack also provisions a dedicated CloudWatch log group and creates an IAM role for logging.

To implement these changes, open **_lib/quizsyncbackend-stack.ts_** and update it with the stack definition code:

```ts
import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface QuizSyncStackProps extends cdk.StackProps {
  environment?: string;
  enableTracing?: boolean;
  logRetentionDays?: logs.RetentionDays;
}

export class QuizSyncStack extends cdk.Stack {
  public readonly eventApi: appsync.EventApi;

  constructor(scope: Construct, id: string, props: QuizSyncStackProps = {}) {
    super(scope, id, props);

    const {
      environment = "dev",
      logRetentionDays = logs.RetentionDays.ONE_WEEK,
    } = props;

    // Create log configuration
    const logConfig: appsync.AppSyncLogConfig = {
      retention: logRetentionDays,
      excludeVerboseContent: false,
      fieldLogLevel: appsync.AppSyncFieldLogLevel.ALL,
    };

    // Create AppSync Events API with security best practices using L2 construct
    this.eventApi = new appsync.EventApi(this, "QuizSyncEventApi", {
      apiName: `QuizSyncEventApi-${environment}`,
      authorizationConfig: {
        authProviders: [
          {
            authorizationType: appsync.AppSyncAuthorizationType.API_KEY,
          },
        ],
        connectionAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultPublishAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        defaultSubscribeAuthModeTypes: [
          appsync.AppSyncAuthorizationType.API_KEY,
        ],
      },
      logConfig,
      ownerContact: "QuizSync Admin",
    });

    // Add tags to the API
    cdk.Tags.of(this.eventApi).add("Environment", environment);
    cdk.Tags.of(this.eventApi).add("Project", "QuizSync");
    cdk.Tags.of(this.eventApi).add("ManagedBy", "CDK");

    // Create Channel Namespace for quiz events using L2 construct
    const quizNamespace = new appsync.ChannelNamespace(this, "QuizNamespace", {
      api: this.eventApi,
      channelNamespaceName: "quiz", // Creates channels like quiz/game123/lobby
      authorizationConfig: {
        publishAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
        subscribeAuthModeTypes: [appsync.AppSyncAuthorizationType.API_KEY],
      },
    })

    // Add tags to the namespace
    cdk.Tags.of(quizNamespace).add("Environment", environment);
    cdk.Tags.of(quizNamespace).add("Project", "QuizSync");

    // Create API Key with proper expiration (1 year)
    const apiKey = new appsync.CfnApiKey(this, "QuizSyncApiKey", {
      apiId: this.eventApi.apiId,
      description: `API Key for QuizSync Events API - ${environment}`,
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60, // 1 year from now (Unix timestamp)
    });

    // Create comprehensive outputs for Android app
    this.createOutputs(environment, apiKey);
  }

  private createOutputs(environment: string, apiKey: appsync.CfnApiKey) {
    new cdk.CfnOutput(this, "EventApiId", {
      value: this.eventApi.apiId,
      description: "AppSync Events API ID",
      exportName: `QuizSyncEventApiId-${environment}`,
    });

    new cdk.CfnOutput(this, "EventApiEndpoint", {
      value: this.eventApi.realtimeDns,
      description: "AppSync Events WebSocket Endpoint",
      exportName: `QuizSyncEventApiEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, "EventApiHttpEndpoint", {
      value: this.eventApi.httpDns,
      description: "AppSync Events HTTP Endpoint",
      exportName: `QuizSyncEventApiHttpEndpoint-${environment}`,
    });

    new cdk.CfnOutput(this, "ApiKey", {
      value: apiKey.attrApiKey,
      description: "API Key for authentication",
      exportName: `QuizSyncApiKey-${environment}`,
    });

    new cdk.CfnOutput(this, "Region", {
      value: this.region,
      description: "AWS Region",
      exportName: `QuizSyncRegion-${environment}`,
    });
  }
}
```

Now we are ready to, validate that our CDK code compiles correctly and prepare the CDK for deployment: 

```bash
# Install the packages
npm install

# Build the TypeScript project
npm run build

# Synthesize CloudFormation templates (recommended over just building)
cdk synth

# Bootstrap CDK in your AWS account (only needed once per account/region)
cdk bootstrap
```

Now it is time to deploy:

```bash
cdk deploy
```

After the successful deployment, we will see outputs like the following:

```bash
 ✅  QuizSyncStack-dev

✨  Deployment time: 54.26s

Outputs:
QuizSyncStack-dev.ApiKey = <API_KEY_REDACTED>
QuizSyncStack-dev.EventApiEndpoint = <API_ENDPOINT_REDACTED>.appsync-realtime-api.us-east-1.amazonaws.com
QuizSyncStack-dev.EventApiHttpEndpoint = <API_ENDPOINT_REDACTED>.appsync-api.us-east-1.amazonaws.com
QuizSyncStack-dev.EventApiId = <API_ID_REDACTED>
QuizSyncStack-dev.Region = us-east-1
Stack ARN:
arn:aws:cloudformation:us-east-1:<ACCOUNT_ID_REDACTED>:stack/QuizSyncStack-dev/<STACK_ID_REDACTED>

✨  Total time: 57.43s
```

Now that the backend infrastructure is in place, let's build the Android application.

### Building the Android App

A starter project is provided that includes all the necessary UI elements for the application. You can focus on implementing the real-time functionality without building the UI from scratch. Clone the project from [GitHub](https://github.com/salihgueler/QuizSync) to start the implementation. 

::youtube{id="M24t8tHmxDE" title="Building Real-Time Multiplayer Android Apps with AWS AppSync Events API video 1"}

First, enable `isCoreLibraryDesugaringEnabled` for the AWS AppSync Android libraries. Add the following configuration to your app-level **_build.gradle_** file:

```groovy
android {
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        // Enable core library desugaring for AWS SDK compatibility
        isCoreLibraryDesugaringEnabled = true
    }
}
```

Also, add these dependencies to implement the AWS AppSync functionality:

```groovy
dependencies {
    // AWS AppSync Events library
    implementation("com.amazonaws:aws-sdk-appsync-events:1.0.0")
    
    // Core library desugaring for AWS SDK compatibility (updated version)
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
```

After syncing your Gradle changes, configure the AppSync connection details. Open **_config/AppSyncConfig.kt_** and replace the `API_KEY` and `HTTP_ENDPOINT` values with your backend information:

```kotlin
const val API_KEY = "<API-KEY>"

const val HTTP_ENDPOINT = "<API_ENDPOINT_REDACTED>.appsync-api.us-east-1.amazonaws.com/event"
```

Create a new AppSync client to manage the backend connection. In your project:

1. Delete MockAppSyncEventsClient.kt
2. Create a new file called AppSyncEventsClient.kt

```kotlin
package com.example.quizsync.service

import com.example.quizsync.data.GameEvent
import kotlinx.coroutines.flow.Flow

/**
 * AppSync Events API client for QuizSync real-time communication
 */
class AppSyncEventsClient : EventsClient {

    override suspend fun publishEvent(channel: String, event: GameEvent): PublishEventResult {
        TODO("Not yet implemented")
    }

    override fun subscribeToGame(gameId: String): Flow<GameEvent> {
        TODO("Not yet implemented")
    }

    override suspend fun disconnect() {
        TODO("Not yet implemented")
    }
}
```
Add the following variables to **_AppSyncEventsClient.kt_**:

* A WebSocket client to connect to the Events API for updates
* An events endpoint for publishing events
* A custom logger mechanism to display messages (optional)

The client code after adding these variables should look like this:

```kotlin
package com.example.quizsync.service

import android.util.Log
import com.amazonaws.sdk.appsync.core.LogLevel
import com.amazonaws.sdk.appsync.core.Logger
import com.amazonaws.sdk.appsync.core.authorizers.ApiKeyAuthorizer
import com.amazonaws.sdk.appsync.events.Events
import com.amazonaws.sdk.appsync.events.EventsWebSocketClient
import com.example.quizsync.config.AppSyncConfig
import com.example.quizsync.data.GameEvent
import kotlinx.coroutines.flow.Flow

/**
 * AppSync Events API client for QuizSync real-time communication
 */
class AppSyncEventsClient : EventsClient {
    
    // Initialize Events client with HTTP endpoint
    private val events: Events = Events(AppSyncConfig.HTTP_ENDPOINT)
    private val apiKeyAuthorizer = ApiKeyAuthorizer(AppSyncConfig.API_KEY)

    private val webSocketClient: EventsWebSocketClient = events.createWebSocketClient(
        connectAuthorizer = apiKeyAuthorizer,
        subscribeAuthorizer = apiKeyAuthorizer,
        publishAuthorizer = apiKeyAuthorizer,
        options = Events.Options.WebSocket(
            loggerProvider = { namespace -> AndroidLogger(namespace, LogLevel.DEBUG) }
        )
    )

    private val restApiClient: EventsRestClient = events.createRestClient(
        publishAuthorizer = apiKeyAuthorizer,
        options = Events.Options.Rest(
            loggerProvider = { namespace -> AndroidLogger(namespace, LogLevel.DEBUG) }
        )
    )
    
    override suspend fun publishEvent(channel: String, event: GameEvent): PublishEventResult {
        TODO("Not yet implemented")
    }

    override fun subscribeToGame(gameId: String): Flow<GameEvent> {
        TODO("Not yet implemented")
    }

    override suspend fun disconnect() {
        TODO("Not yet implemented")
    }
}

/**
 * Android Logger implementation for AppSync Events library
 */
class AndroidLogger(
    private val namespace: String,
    override val thresholdLevel: LogLevel
) : Logger {

    override fun error(message: String) {
        if (!thresholdLevel.above(LogLevel.ERROR)) {
            Log.e(namespace, message)
        }
    }

    override fun error(message: String, error: Throwable?) {
        if (!thresholdLevel.above(LogLevel.ERROR)) {
            Log.e(namespace, message, error)
        }
    }

    override fun warn(message: String) {
        if (!thresholdLevel.above(LogLevel.WARN)) {
            Log.w(namespace, message)
        }
    }

    override fun warn(message: String, issue: Throwable?) {
        if (!thresholdLevel.above(LogLevel.WARN)) {
            Log.w(namespace, message, issue)
        }
    }

    override fun info(message: String) {
        if (!thresholdLevel.above(LogLevel.INFO)) {
            Log.i(namespace, message)
        }
    }

    override fun debug(message: String) {
        if (!thresholdLevel.above(LogLevel.DEBUG)) {
            Log.d(namespace, message)
        }
    }

    override fun verbose(message: String) {
        if (!thresholdLevel.above(LogLevel.VERBOSE)) {
            Log.v(namespace, message)
        }
    }
}
```

Update the `publishEvent` function to publish messages to the Events API. This function uses the specified channel name to route messages to the appropriate subscribers:

```kotlin

/**
* Publish a game event to a specific channel
* 
* Make sure to add the below imports
* import com.amazonaws.sdk.appsync.events.data.PublishResult 
* import kotlinx.serialization.encodeToString 
* import kotlinx.serialization.json.Json
*/
override suspend fun publishEvent(channel: String, event: GameEvent): PublishEventResult {
    return try {
        val jsonElement = Json.encodeToJsonElement(event)
        Log.d("AppSyncEvents", "Publishing to channel: $channel, event: $jsonElement")
        // Get the AWS PublishResult from the SDK
        val publishResult = webSocketClient.publish(
            channelName = channel,
            event = jsonElement
        )
        // Convert AWS PublishResult to our generic PublishEventResult
        when (publishResult) {
            is PublishResult.Response -> {
                Log.d(
                    "AppSyncEvents",
                    "Publish successful: ${publishResult.successfulEvents.size} events sent"
                )
                if (publishResult.failedEvents.isNotEmpty()) {
                    Log.w(
                        "AppSyncEvents",
                        "Some events failed: ${publishResult.failedEvents.size}"
                    )
                    PublishEventResult.Failure("Some events failed: ${publishResult.failedEvents.joinToString()}")
                } else {
                    PublishEventResult.Success("Successfully published ${publishResult.successfulEvents.size} events")
                }
            }
            is PublishResult.Failure -> {
                Log.e("AppSyncEvents", "Publish failed", publishResult.error)
                PublishEventResult.Failure(
                    "AWS publish failed: ${publishResult.error.message}",
                    publishResult.error
                )
            }
        }
    } catch (e: Exception) {
        Log.e("AppSyncEvents", "Exception during publish", e)
        PublishEventResult.Failure("Exception during publish: ${e.message}", e)
    }
}
```

Add the `subscribeToGame` function to handle and map incoming events. This function converts incoming messages into `GameEvent` objects, which represent different game states such as:

* Player joins
* Answer submissions
* Other game-related events

```kotlin
/**
* Subscribe to all channels for a specific game using wildcard
* Make sure to import the following:
* import kotlinx.coroutines.flow.catch 
* import kotlinx.coroutines.flow.map 
* import kotlinx.coroutines.flow.onCompletion
* import kotlinx.serialization.json.decodeFromJsonElement
*/
override fun subscribeToGame(gameId: String): Flow<GameEvent> {
    val wildcardChannel = allGameChannels(gameId)
    return subscribeToChannel(wildcardChannel)
}

/**
 * Wildcard subscription for all game channels
 */
private fun allGameChannels(gameId: String) = "quiz/$gameId/*"

/**
 * Subscribe to a channel and receive game events
 */
private fun subscribeToChannel(channel: String): Flow<GameEvent> {
    Log.d("AppSyncEvents", "Subscribing to channel: $channel")
    return webSocketClient.subscribe(channel)
        .onCompletion {
            Log.d("AppSyncEvents", "Subscription to $channel completed")
        }
        .catch { throwable ->
            Log.e("AppSyncEvents", "Subscription to $channel failed", throwable)
            throw throwable
        }
        .map { eventsMessage ->
            try {
                // Convert JsonElement to GameEvent
                Json.decodeFromJsonElement<GameEvent>(eventsMessage.data)
            } catch (e: Exception) {
                Log.e("AppSyncEvents", "Error parsing event data", e)
                // Return a generic error event
                GameEvent.Error("Failed to parse event data: ${e.message}")
            }
        }
}
```
To properly manage resources, implement the cleanup function to disconnect any active WebSocket connections:

```kotlin
/**
* Disconnect the WebSocket client
*/
override suspend fun disconnect() {
    try {
        Log.d("AppSyncEvents", "Disconnecting WebSocket client")
        webSocketClient.disconnect(flushEvents = true)
    } catch (e: Exception) {
        Log.e("AppSyncEvents", "Error disconnecting WebSocket", e)
    }
}
```
Now you test the real-time functionality by:

1. Building and running the application on your device or emulator.
2. Observing the real-time updates as they appear on the screen.

::youtube{id="WasOZQzEvhg" title="Building Real-Time Multiplayer Android Apps with AWS AppSync Events API video 2"}

### Clean up resources

To avoid ongoing charges, delete the resources you created:

1. Run the following command to destroy all CDK-deployed resources:

```bash
cdk destroy
```

2. Verify the cleanup in the AWS Management Console by confirming that the resources have been deleted.

## Wrapping Up

AWS AppSync's Events API provides a managed solution for implementing real-time functionality in your applications. This solution offers several benefits:

* Managed WebSocket connections eliminate the need for custom infrastructure maintenance
* Client libraries simplify implementation
* Infrastructure as code through CDK enables consistent deployments

For detailed information, see the [AWS AppSync documentation](https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-welcome.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) and official documentation for [Android libraries](https://docs.amplify.aws/android/build-a-backend/data/connect-event-api?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el). Also, you can check the fully implementation version of the project over [GitHub](https://github.com/salihgueler/QuizSync/tree/completed).

If you're using AI development tools like Amazon Q Developer CLI, configure your environment to use Model Context Protocol (MCP) servers from [AWS Labs](https://github.com/awslabs/mcp) in your coding assistants.
