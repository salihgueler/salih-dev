---
title: "Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock!"
description: "Build a personalized Flutter quiz game using AWS Amplify Gen 2, API Gateway, Lambda, and Amazon Bedrock."
pubDate: "2024-01-28T15:44:55Z"
category: "Flutter"
tags: ["flutter","aws","awsamplify","bedrock"]
hero:
  src: "https://salih.dev/images/blog/1743661-building-a-personalized-quiz-game-with-flutter-aws-amplify-gen2-and-amazon-bedrock-51gk.webp"
  alt: "Cover image for Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock!"
  credit: "DEV Community"
  creditUrl: "https://dev.to/salihgueler/building-a-personalized-quiz-game-with-flutter-aws-amplify-gen2-and-amazon-bedrock-51gk"
aiSummary: "Build a personalized Flutter quiz game using AWS Amplify Gen 2, API Gateway, Lambda, and Amazon Bedrock."
originalUrl: "https://dev.to/salihgueler/building-a-personalized-quiz-game-with-flutter-aws-amplify-gen2-and-amazon-bedrock-51gk"
sources: [{"name":"DEV Community","url":"https://dev.to/salihgueler/building-a-personalized-quiz-game-with-flutter-aws-amplify-gen2-and-amazon-bedrock-51gk"}]
draft: false
---

From Day 1, Flutter has remained a popular choice for developers aiming to create cross-platform applications. AWS Amplify has long supported the development of applications for iOS, Android, Web, and Desktop.

Previously, AWS Amplify assisted developers in provisioning their backends using the Amplify CLI and Libraries. However, since last November, AWS Amplify [announced](https://aws.amazon.com/blogs/mobile/introducing-amplify-gen2/) a new generation of backend development.

This new [code-first developer experience](https://aws.amazon.com/amplify/code-first-development/) empowers developers to quickly build and deploy their backends by utilizing their TypeScript/JavaScript skills for backend development or extending the capabilities of AWS Amplify with their CDK knowledge.

AWS Cloud Development Kit (AWS CDK) accelerates cloud development using common programming languages to model your applications. Constructs—the basic building blocks of AWS Cloud Development Kit (AWS CDK) apps—abstract away the complexity of configuring cloud resources to work with API Gateway, Lambda, and one of the cool kids - Amazon Bedrock.

Amazon Bedrock is a fully managed service that offers a choice of high-performing foundation models (FMs).

In this blog post, you will be building a personalized quiz application that leverages AWS Amplify Gen2 and Amazon Bedrock.

::youtube{id="KAzXycBz5Oo" title="Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock! video 1"}

You can also find the source code of the project on [GitHub](https://github.com/salihgueler/triv_ai).

> This tutorial will make extensive use of Amplify Gen 2. Currently in developer preview, Amplify Gen 2's mobile support is not fully implemented yet. As a result, the code samples and contracts may be subject to change. For the most up-to-date version of the app, please refer to the repository.

Before you get started, ensure that you have the following installed:

- [Node.js](https://nodejs.org/en) v18.17 or later
- [npm](https://www.npmjs.com/) v9 or later
- [git](https://git-scm.com/) v2.14.1 or later
- [Flutter](https://docs.flutter.dev/get-started/install) 3.3.0 or later

Additionally, you will need to [create an AWS account](https://portal.aws.amazon.com/billing/signup). Please note that AWS Amplify is included in the AWS Free Tier. [Follow the instructions](https://docs.amplify.aws/gen2/start/account-setup/) to configure your AWS account for use with Amplify.

## Flutter Side

As with many other applications, your app will serve as the bridge between your data and your user. If you check out the [starter project](https://github.com/salihgueler/triv_ai/tree/starter_project), you will find a basic app as shown below:

::youtube{id="Pu1cF6zepyk" title="Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock! video 2"}

The app:
- Utilizes Cubit (a simpler version of [bloc](https://pub.dev/packages/bloc)) for state management. It leverages [flutter_bloc](https://pub.dev/packages/flutter_bloc) and [equatable](https://pub.dev/packages/equatable) for implementation assistance.
- Implements [go_router](https://pub.dev/packages/go_router) for navigation.
- Incorporates [google_fonts](https://pub.dev/packages/google_fonts) for custom font implementation and [flex_color_scheme](https://pub.dev/packages/flex_color_scheme) for easy theming.

From the project perspective:

- `QuizCubit` manages and caches quiz operations.
- `QuizState` oversees changes in the state.
- Each screen (the entire UI) and view (a portion of the UI) is created under the _ui_ folder.

## Adding AWS Amplify Gen2 to the project

To add AWS Amplify functionalities to your application, you need to run the following command:

```bash
npm create amplify
```

Afterward, select the base project path and let it do its magic:

```
? Where should we create your project? (.) # Press enter if you are at your root folder
```

Once the process is complete, a new folder named **amplify** will appear in your project. This folder contains TypeScript files that enable you to define and deploy your backend using a minimal yet code-powered approach.

The next step is to build the backend, starting with authentication.

![Folder structure for Amplify Gen 2](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/kurqga6fs0t8kq8k7bol.png)

AWS Amplify Gen 2's new file-based structure enables you to create your infrastructure using code.

To add authentication, open the `resource.ts` file in the `auth` folder and update it as follows:

```typescript
import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
    loginWith: {
        email: true
    },
    userAttributes: {
        preferredUsername: {
            required: true,
        },
    }
});
```

This configuration allows users to log in using their email or phone number, and you can specify any attributes you want to require.

Now it is time to define your data layer. Ppen the `resource.ts` file in the `data` folder and update it as follows:

```typescript
import {type ClientSchema, a, defineData} from '@aws-amplify/backend';

const schema = a.schema({
    Question: a
        .model({
            title: a.string().required(),
            answer: a.string().required(),
            category: a.string().required(),
            difficulty: a.string().required(),
            options: a.string().array().required(),
            createdAt: a.datetime(),
            updatedAt: a.datetime(),
            result: a.belongsTo("Result"),
        })
        .authorization([a.allow.owner()]),

    Result: a.model({
        score: a.float().required(),
        correctAnswerCount: a.integer().required(),
        answers: a.string().array().required(),
        questions: a.hasMany("Question"),
        createdAt: a.datetime(),
        updatedAt: a.datetime(),
    }).authorization([a.allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool'
    }
});
```

In the code mentioned earlier, you are defining a `question` object that will be stored in a `result` object following a quiz. The `result` object will contain the score, answers, and the number of correct answers, along with the questions.

Now, it's time to test our deployment. In previous versions of AWS Amplify, each iteration on the backend required a deployment. However, with the latest generation, you can now use a CDK-powered local sandbox environment to test and rapidly iterate your backend.

To start the sandbox, run the `amplify sandbox` command as follows:

```bash
npx amplify sandbox --config-format=dart --config-out-dir=lib    
```

This command initiates a sandbox environment and monitors changes in your backend files to start deployment when it is needed.

After deploying the sandbox, it's time to connect the new backend to the Flutter side.

## Using AWS Amplify with Flutter

First, add authentication to Flutter using the [Amplify UI Authenticator libraries](https://ui.docs.amplify.aws/flutter). Start by adding the required libraries:

```bash
flutter pub add amplify_authenticator
flutter pub add amplify_auth_cognito
flutter pub add amplify_flutter
```

Afterwards, update the `main.dart` file to control the authentication flow:

```dart
import 'package:amplify_auth_cognito/amplify_auth_cognito.dart';
import 'package:amplify_authenticator/amplify_authenticator.dart';
import 'package:amplify_flutter/amplify_flutter.dart';
import 'package:flex_color_scheme/flex_color_scheme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:triv_ai/amplifyconfiguration.dart';
import 'package:triv_ai/quiz/data/quiz_cubit.dart';
import 'package:triv_ai/result/data/results_cubit.dart';
import 'package:triv_ai/routes.dart';

// ignore: depend_on_referenced_packages
import 'package:flutter_web_plugins/url_strategy.dart';

Future<void> main() async {
  usePathUrlStrategy();
  try {
    WidgetsFlutterBinding.ensureInitialized();
    await _configureAmplify();
    runApp(const TrivAIApp());
  } on AmplifyException catch (e) {
    safePrint('Error configuring Amplify: $e');
    runApp(ErrorWidget(e));
  }
}

Future<void> _configureAmplify() async {
  try {
    await Amplify.addPlugins([
      AmplifyAuthCognito(),
    ]);
    await Amplify.configure(amplifyConfig);
    safePrint('Successfully configured');
  } on Exception catch (e) {
    safePrint('Error configuring Amplify: $e');
  }
}

class TrivAIApp extends StatelessWidget {
  const TrivAIApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Authenticator(
      child: MultiBlocProvider(
        providers: [
          BlocProvider(
            create: (context) => QuizCubit(),
          ),
          BlocProvider(
            create: (context) => ResultsCubit(),
          ),
        ],
        child: MaterialApp.router(
          debugShowCheckedModeBanner: false,
          builder: Authenticator.builder(),
          routerDelegate: router.routerDelegate,
          routeInformationParser: router.routeInformationParser,
          routeInformationProvider: router.routeInformationProvider,
          theme: FlexThemeData.light(
            scheme: FlexScheme.blueWhale,
            fontFamily: GoogleFonts.kanit().fontFamily,
          ),
          darkTheme: FlexThemeData.dark(
            scheme: FlexScheme.blueWhale,
            fontFamily: GoogleFonts.kanit().fontFamily,
          ),
        ),
      ),
    );
  }
}
```

and update the `signOut` function like the following:

```dart
void signOut() {
  Amplify.Auth.signOut();
}
```

Three important points to mention:
1. `_configureAmplify` gets the Amplify configurations and enables them for the app before it starts.
2. The `Authenticator` widget controls the entire authentication flow with the contract you decided.
3. You can also call the authentication libraries when you need them. In the app, we are calling the `signOut` function.

Now, if you run the application, you should see the authentication flow in action.

::youtube{id="duuwkj7GwaU" title="Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock! video 3"}

The second step involves adding the GraphQL API to the Flutter project. Before integrating Flutter libraries, we need to generate model classes based on our earlier API contract. To do this, run the following command:

```bash
npx amplify generate graphql-client-code --format=modelgen --model-target=dart --out=lib/models
```

This command generates the model classes in Dart, located in the _lib/models_ folder. Next, it's time to add the necessary libraries. Execute the following command:

```bash
flutter pub add amplify_api
```

Then, update the `_configureAmplify` function by incorporating the API category into the configuration, as shown below:

```dart
Future<void> _configureAmplify() async {
  try {
    await Amplify.addPlugins([
      AmplifyAuthCognito(),
      AmplifyAPI(modelProvider: ModelProvider.instance)
    ]);
    await Amplify.configure(amplifyConfig);
    safePrint('Successfully configured');
  } on Exception catch (e) {
    safePrint('Error configuring Amplify: $e');
  }
}
```

With these changes, we've added the API category and the models to be used in the application. 

Now, it's time to introduce the exciting feature: AI.

## Adding Amazon Bedrock to the Project Backend

Amazon Bedrock is not supported by AWS Amplify Gen 2. However, thanks to the new approach powered by CDK, we can create a backend property to deliver any cloud resource we would like to have.

The first step is to go back to our _amplify_ folder and create a new folder called _custom_, which will hold our custom operations. You can split the custom connections into different folders. In this example, you will create a new _BedrockConnection_ folder.

Like the other parts of the backend, you will create a new _resource.ts_ file for your cloud operations. Paste the following code into the _resource.ts_ file:

```typescript
import { Construct } from "constructs/lib/construct.js";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { CfnOutput, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as url from "node:url";

export class BedrockConnection extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create Lambda function
    const quizFunction = new NodejsFunction(this, "generateQuiz", {
      entry: url.fileURLToPath(new URL("index.ts", import.meta.url)),
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      timeout: Duration.minutes(15),
    });

    // Create API Gateway
    const api = new RestApi(this, "QuizApi");

    // Add resource and method to the API Gateway
    const generateQuizResource = api.root.addResource("generateQuiz");
    const integration = new LambdaIntegration(quizFunction);
    generateQuizResource.addMethod("GET", integration);

    // Output the API Gateway endpoint URL
    new CfnOutput(this, "ApiEndpoint", {
      value: api.url,
      description: "Endpoint for the Quiz API",
    });
  }
}
```

This code sets up a CDK construct that creates an API using Amazon API Gateway and AWS Lambda.

A NodejsFunction is defined to host the Lambda function. The entry point is set to an _index.ts_ file, with a 15-minute timeout.

A RestApi is constructed to define the API Gateway endpoint. The Lambda function is attached to the root resource "/generateQuiz" via a LambdaIntegration.

Finally, a CloudFormation Output is added to surface the API endpoint URL for easy access after deployment.

This setup allows hosting a serverless REST API where the Lambda function can be invoked via the API Gateway. The CDK makes it easy to define the infrastructure as code.

Next, we will create the _index.ts_ file for the handler to perform the operation.

```typescript
import { Handler } from "aws-cdk-lib/aws-lambda";
import { generateQuiz } from "./prompt.js";

export const handler: Handler = async (event: {
  queryStringParameters: {
    questionCount: String;
    categoryList: String;
    difficulty: String;
  };
}) => {
  const { questionCount, categoryList, difficulty } =
    event.queryStringParameters;

  const result = await generateQuiz(questionCount, categoryList, difficulty);
  return {
    headers: {'Content-Type': 'application/json'},
    statusCode: 200,
    body: JSON.stringify({ message: result }),
  };
}
```

This code generates a quiz by calling the _generateQuiz_ function from the ./prompt.js file.

It defines a Lambda handler function that is invoked when the Lambda is triggered. The handler accepts an event parameter containing query string parameters: _questionCount_, _categoryList_, and _difficulty_.

These parameters are extracted from the event and passed to the `generateQuiz` function, which uses them to generate a quiz.

The handler then returns a JSON response with a status code of 200. It sets the 'Content-Type' header and stringifies an object with a "message" property containing the result from generateQuiz.

This setup allows the Lambda to be triggered with query parameters to dynamically generate a quiz and returns the result as JSON, which can be consumed by a client application.

The next step is to create a _prompt.ts_ file to call Amazon Bedrock with the correct prompt and information.

```typescript
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({
  region: "eu-central-1",
});

export const generateQuiz = async (
  questionCount: String,
  categoryList: String,
  difficulty: String
) => {
  const promptText = `
  \n\nHuman:
  You are a quiz question generator.

  Create exactly ${questionCount} questions, evenly distributed across the following categories: ${categoryList}. Ensure the questions align with ${difficulty} difficulty level.

  Requirements for each question:
  - Return the result as a list of JSON objects. 
  - Return the question with json key 'question'.
  - Include 4 different answer options, with json key 'options', each a string.
  - Specify 1 correct answer, with json key 'correctAnswer', in string format.
  - Return the category with json key 'category'.
  - Questions should not be repeated.
  \n\nAssistant:
`;


  const input = {
    modelId: "anthropic.claude-v2",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      prompt: promptText,
      max_tokens_to_sample: 8192,
    }),
  };
  const command = new InvokeModelCommand(input);
  const response = await client.send(command);

  return JSON.parse(Buffer.from(response.body).toString("utf-8"));
};

```

Lastly, we will connect this CDK construct to our backend. Open the _backend.ts_ file and update it as follows:

```typescript
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { BedrockConnection } from "./custom/BedrockConnection/resource.js";

const backend = defineBackend({
  auth,
  data,
});

new BedrockConnection(
  backend.createStack('BedrockConnection'),
  'BedrockConnection',
);
```

This integration allows you to include a custom resource in the Amplify backend. The `auth` and `data` resources provide standard functionalities, while `BedrockConnection` introduces additional custom logic.

Writing all this code will prepare the backend for operations. However, proper IAM policies are required to execute prompts on Amazon Bedrock.

The first step is to add the Amazon Bedrock policies. Navigate to the AWS Console and access [IAM](https://console.aws.amazon.com/iam/). Locate your current user and open the details:

![IAM Detail Page](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/t4v8ip70nu52pvs34kuq.png)

Attach a new policy by clicking the "Add Permissions" button. Search for the Bedrock policies and attach them, either as a package or individually.

![Policies page](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/a9rwjzm6t62pph1fa103.png)

Lambda will create a role to manage the resources. You can either create your own role and attach it, or update the attached role with the necessary permissions.

With our current setup, we can attach a role via the AWS Console. Open the AWS Console and navigate to the IAM page. Then, click on **Roles** and find the related role by searching for the "BedrockConnection" Lambda.

![IAM Role Permissions](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/b3b4v61tqzmzskg9phhq.png)

Next, add the Amazon Bedrock permission to the Role in the same way you did for your IAM user.

Your sandbox environment is now ready for using Amazon Bedrock.

## Connecting to the API from Flutter

We have two distinct sets of APIs. The first is the GraphQL API, which handles results and questions. The second is the Rest API, serving as our gateway to Amazon Bedrock.

First, let's explore how to call Amazon Bedrock from our Flutter application.

Initially, we need to add the HTTP package to call our API. Run the following command to add the HTTP package:

```bash
flutter pub add http
```

Next, we will replace the question object created under `question/data/question.dart` and result object under `result/data/result.dart` with the generated one.

We will import the correct `Question` object into `QuestionView` and update the `QuizCubit` as follows to generate questions:

```dart
import 'dart:convert';

import 'package:amplify_api/amplify_api.dart';
import 'package:amplify_flutter/amplify_flutter.dart';
import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:triv_ai/models/ModelProvider.dart';
import 'package:http/http.dart' as http;

part 'quiz_state.dart';

class QuizCubit extends Cubit<QuizState> {
  QuizCubit() : super(QuizInitial());

  final _answers = <String>[];

  Future<void> generateQuestions(
    int questionCount,
    List<String> categories,
    String difficulty,
  ) async {
    emit(QuizLoading());
    final url = Uri.https(
      '<API-ID>.execute-api.<REGION>.amazonaws.com',
      'prod/generateQuiz',
      {
        "questionCount": questionCount.toString(),
        "categoryList": categories.join(","),
        "difficulty": difficulty,
      },
    );
    try {
      final response = await http.get(
        url,
        headers: {
          "Access-Control-Allow-Origin": "*",
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
      );
      final content = json.decode(response.body);
      final outputText = content["message"]["completion"] as String;
      final firstIndex = outputText.indexOf("[");
      final lastIndex = outputText.lastIndexOf("]");
      final chopped = outputText.substring(firstIndex, lastIndex + 1);
      final jsonToParse = json.decode(chopped) as List<dynamic>;
      final questions = <Question>[];
      for (final parsedElement in jsonToParse) {
        final optionsDynamic = parsedElement['options'] as List<dynamic>;
        final options = optionsDynamic.cast<String>();
        questions.add(
          Question(
            title: parsedElement['question'] as String,
            answer: parsedElement['correctAnswer'] as String,
            category: parsedElement['category'] as String,
            difficulty: difficulty,
            options: options,
            createdAt: TemporalDateTime(DateTime.now()),
            updatedAt: TemporalDateTime(DateTime.now()),
          ),
        );
        emit(QuizSuccess(questions, questions.first, 0));
      }
    } on Exception catch (e) {
      emit(QuizError('Could not fetch the questions: \n\n$e'));
    }
  }

  void fetchQuestions() {
    if (state is QuizSuccess) {
      emit(
        QuizSuccess(
          (state as QuizSuccess).questions,
          (state as QuizSuccess).currentQuestion,
          (state as QuizSuccess).currentQuestionIndex,
        ),
      );
    } else {
      emit(const QuizError('Quiz not found'));
    }
  }

  Future<void> changeQuestion(String selectedOption) async {
    _answers.add(selectedOption);
    if (state is QuizSuccess) {
      final questions = (state as QuizSuccess).questions;
      final currentQuestionIndex = (state as QuizSuccess).currentQuestionIndex;
      if (currentQuestionIndex < questions.length - 1) {
        emit(
          QuizSuccess(
            questions,
            questions[currentQuestionIndex + 1],
            currentQuestionIndex + 1,
          ),
        );
      } else {
        final score = _calculateScore(questions, _answers);
        emit(
          QuizFinishedState(
            questions,
            _answers,
            score,
          ),
        );
      }
    } else {
      emit(const QuizError('Quiz not found'));
    }
  }

  double _calculateScore(List<Question> questions, List<String> answers) {
    final scorePerQuestion = 100 / questions.length;
    var score = 0.0;
    for (var i = 0; i < questions.length; i++) {
      if (questions[i].answer == answers[i]) {
        score += scorePerQuestion;
      }
    }
    return score;
  }

  void resetQuiz() {
    emit(QuizInitial());
    _answers.clear();
  }

  Future<void> saveQuiz() async {
     emit(QuizSaved());
  }
}
```

1. It generates questions by making a network request to an AWS API Gateway endpoint, parsing the JSON response, and mapping it to `Question` model objects.
2. The state contains the current list of questions, the current question being displayed, and the index of that question.
3. Methods like `changeQuestion` and `fetchQuestions` update the state by moving to the next question or re-emitting the current state.
4. `changeQuestion` also tracks the user's answers in a list and calculates a score when all questions are answered by comparing answers to the correct answers.
5. The `resetQuiz` method resets the state and clears the answers, allowing the quiz to be restarted.

Now, deploy your API with API Gateway. Open [API Gateway](https://console.aws.amazon.com/apigateway) from the console. Open the Quiz API and click the **Deploy API** button to deploy it to any stage of your choice. Afterwards, it will take you to the _Stages_. There, you can see your base URL and deployed environment.

If you run the application now, you will see the following:

::youtube{id="6f436AFGHPs" title="Building a Personalized Quiz Game with Flutter, AWS Amplify Gen2, and Amazon Bedrock! video 4"}

The next step is to use the GraphQL API to save the results and view them when needed.

Navigate to your _quiz_cubit.dart_ file and update it as follows:

```dart
Future<void> saveQuiz() async {
  if (state is QuizFinishedState) {
    final currentState = (state as QuizFinishedState);
    final questions = currentState.questions;
    final answers = currentState.answers;
    final score = currentState.score;
    int correctAnswerCount = 0;
    for (var i = 0; i < questions.length; i++) {
      if (questions[i].answer == answers[i]) {
        correctAnswerCount++;
      }
    }
    emit(QuizLoading());
    final result = Result(
      score: score,
      correctAnswerCount: correctAnswerCount,
      answers: answers,
    );
    final mutation = ModelMutations.create(result);
    try {
      final response = await Amplify.API.mutate(request: mutation).response;
      for (final question in currentState.questions) {
        final questionMutation = ModelMutations.create(
          question.copyWith(
            resultQuestionsId: result.id,
            updatedAt: TemporalDateTime(DateTime.now()),
          ),
        );
        final questionResult =
            await Amplify.API.mutate(request: questionMutation).response;
        if (questionResult.hasErrors) {
          throw Exception(questionResult.errors.toString());
        }
      }
      if (response.hasErrors) {
        emit(QuizError(response.errors.toString()));
      } else {
        emit(QuizSaved());
        resetQuiz();
      }
    } on Exception catch (e) {
      emit(QuizError(e.toString()));
    }
  }
}
```

The code above:

1. It first checks that the current state is a QuizFinishedState, meaning the user has completed the quiz. It then extracts the questions, answers, and score from that state.
2. It loops through the questions and answers to count the number of correct answers.
3. It emits a loading state to indicate the save is in progress.
4. It creates a Result object with the score, correct count, and answers to save to the database.
5. It uses the Amplify API to mutate (create/save) the Result object.
6. It then loops through each question again, updating the question objects with the new result ID and timestamp. It mutates each question to the database.
7. If any errors occur during the API calls, it emits an error state with the error message.
8. If everything saves successfully, it emits a saved state and resets the quiz data before the user can start a new one.

Following that, the next step is to read the saved result information. To do this, open the _results_cubit.dart_ file and update the `getResults` function as follows:

```dart
  Future<void> getResults() async {
    emit(ResultsLoading());
    try {
      const graphQLDocument = '''
query ListResults {
  listResults {
    items {
      id
      answers
      correctAnswerCount
      score
      questions {
        items {
          id
          answer
          category
          difficulty
          options
          title
          updatedAt
        }
      }
    }
  }
}
    ''';
      final getResultRequest = GraphQLRequest<String>(
        document: graphQLDocument,
      );
      final response =
          await Amplify.API.query(request: getResultRequest).response;

      if (response.hasErrors || response.data == null) {
        emit(ResultsError(response.errors.toString()));
      } else {
        final rawResults = response.data;
        final parsedResults = json.decode(rawResults!) as Map<String, dynamic>;
        final results = (parsedResults['listResults']['items'] as List<dynamic>)
            .cast<Map<String, dynamic>>()
            .map(
              (e) => Result(
                id: e['id'] as String,
                answers: (e['answers'] as List<dynamic>).cast<String>(),
                correctAnswerCount: e['correctAnswerCount'] as int,
                score: e['score'] as double,
                questions: (e['questions']['items'] as List<dynamic>)
                    .cast<Map<String, dynamic>>()
                    .map(
                      (e) => Question(
                        id: e['id'] as String,
                        answer: e['answer'] as String,
                        category: e['category'] as String,
                        difficulty: e['difficulty'] as String,
                        options: (e['options'] as List<dynamic>).cast<String>(),
                        title: e['title'] as String,
                        updatedAt: TemporalDateTime.fromString(
                            e['updatedAt'] as String),
                      ),
                    )
                    .toList(growable: false)
                  ..sort(
                    (a, b) => a.updatedAt!
                        .getDateTimeInUtc()
                        .compareTo(b.updatedAt!.getDateTimeInUtc()),
                  ),
              ),
            )
            .toList(growable: false);
        emit(ResultsSuccess(results));
      }
    } on Exception catch (e) {
      emit(ResultsError(e.toString()));
    }
  }
```

Here's an explanation of what the code does:

1. It defines the GraphQL query document as a multi-line string. This queries for a list of results with associated questions.
2. It creates a GraphQLRequest object using this document to make the API request.
3. It calls the Amplify API to execute the query and get a response.
4. It checks for errors in the response. If errors exist, it emits a error state.
5. If no errors, it parses the JSON response data into Dart objects.
6. It maps over the result items to create Result objects with associated Question objects.
7. It sorts the questions by their updatedAt date.
8. If successful, it emits a success state with the list of results.
9. Catches any exceptions and emits an error state.

With this, the app is now feature complete.

## Deploying Resources with Amplify Gen 2

Amplify Gen 2 provides a git-branch-based deployment strategy. To begin the deployment process, publish your project on a Git provider website, such as GitHub.

> Be sure to close your sandbox environment before starting the deployment process.

First, go to the [AWS Amplify console](https://console.aws.amazon.com/amplify/). Click on the **Try Amplify Gen 2** button. If it is not available, click on the **New App** button.

![AWS Amplify Console](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/jo86fd6i3vtvk0yvntg3.png)

Next, select **Option 2: Start with an existing app** to add your application. This will present you with several options to guide you on where to start and where to publish. Choose **GitHub** or any other option that suits you.

![Amplify Gen 2 Project Creation](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3f2xwvqwq9em34bjipqk.png)

Authenticate with the Git provider and select your repository and branch.

![Git provider selection page](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/frqeyt04ps9yjm0d3yd2.png)

Once it verifies that it is a Gen 2 project, select everything and start the deployment process. Once it is deployed, you are ready.

> You need to go through the "add permission" and "deploy your API" steps from the previous instructions again.

![Deployed page](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/b216txr8v5btu11qlngi.png)

After the application is deployed, it is time to regenerate the configuration files for the project.

To do that, run the following command. This command is used to generate configuration information after deployment:

```bash
npx amplify generate config --app-id=<app-id> --branch=main --format=dart --out-dir=lib
```

If you run the application now, you will see that everything is working as expected.

## Conclusion

When app developers work on applications, they always consider the backend as a source of information or authentication. However, the cloud can help you achieve goals where the only limit will be your imagination.

Thanks to Amplify Gen2, simple tasks will remain simple, and complicated tasks will become simpler.

Go ahead, check out [Amplify Gen2](https://docs.amplify.aws/gen2/), and let us know what you think about it.

If you have any questions, feel free to ask them on [LinkedIn](https://www.linkedin.com/in/salihgueler/) and [Twitter](https://twitter.com/salihgueler).

### Resources

- [Amplify Gen2 Docs](https://docs.amplify.aws/gen2/)
- [Bedrock CDK Docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrock-readme.html)
- [Bedrock Python API Setup](https://docs.aws.amazon.com/bedrock/latest/userguide/api-setup.html)
- [Bedrock Inference Models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters.html)
