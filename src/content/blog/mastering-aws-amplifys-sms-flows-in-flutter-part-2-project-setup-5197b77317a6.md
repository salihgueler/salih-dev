---
title: "Mastering AWS Amplify’s SMS Flows in Flutter — Part 2: Project Setup"
description: "Create a Flutter project, initialize AWS Amplify, and prepare the application for an SMS authentication flow."
pubDate: "2022-06-30T15:08:23.000Z"
updatedDate: "2022-07-18T00:53:53.013Z"
category: "Flutter"
tags: ["amplify","flutter","aws","flutter-app-development","mobile-app-development"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*UPt7TxQjKAfFFITZlXGs_A.png"
  alt: "Cover image for Mastering AWS Amplify’s SMS Flows in Flutter — Part 2: Project Setup"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6"
aiSummary: "Create a Flutter project, initialize AWS Amplify, and prepare the application for an SMS authentication flow."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6"}]
draft: false
---

## Connecting AWS Amplify with Flutter projects

Previously, you set up your computer to use AWS Amplify. Now it is time to set up the project to build up the ground work.

In the span of this blog post series, you will be learning:

-   [Creating an AWS Account](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Setting up Amplify CLI on your machine](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Creating a new Flutter project from Flutter CLI tool](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6) (Current post)
-   [Initializing the AWS Amplify project by using Amplify CLI into your Flutter project](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6) (Current post)
-   [Implementing a sign up flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7)
-   [Implementing a sign in flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18)

[View embedded media](https://media.giphy.com/media/6R2mLi910HL4VXFwOG/giphy.gif)

## Creating a new Flutter project from Flutter CLI tool

Once you have your Flutter setup ready, you can create your project either from the IDE of your choice by using Flutter plugins, or you can take advantage of the Flutter’s CLI tool and create a project there as well. To prevent picking sides on the IDE war, create a new Flutter project using the terminal.

First, make sure you are on your project’s root folder. After that run the following command:

```

```

This command will pick the Swift for iOS development, Kotlin for Android development (right now they are default languages for project creation) and create a project for com.yourcompany organization.

> *Keep in mind that organization and the application name should be unique if you are planning to publish this application.*

Once you run the command, you will be seeing a set of messages to let you know that the app is created.

```

```

```

```

```

```

```

```

```

```

Final step is to update the minimum supported versions of the Flutter project:

-   For **Android** you need to set the minimum SDK version to 21 or more. From your project root, navigate to the android/app/ directory and modify build.gradle using a text editor of your choice.

```

```

-   For **iOS** navigate to the ios/ directory and modify the Podfile using a text editor of your choice by updating the line starting with platform :ios, with platform :ios, '11.0'

## Initializing AWS Amplify for your Flutter project

Now that you have a Flutter project and an AWS account that you can use, now you can start to bring the pieces of the puzzle together. First step, initializing the AWS Amplify to your Flutter project.

First go to the folder of your application by using command line tool:

cd /<path-to-the-project>/amplify\_sms\_test

Afterwards, run the following command in your terminal to initialize your Amplify project.

amplify init

This will bring a couple of configuration questions. Answer them according to your configuration settings. If there is a recommendation for you, it will be stated with parentheses next to the question and you can simply click **Enter** to move forward:

```

```

After that Amplify CLI will recommend you some settings to make your setup easier for you:

```

```

```

```

```

```

You can either accept the recommended settings or reject it and enter all settings by yourself. E.g. if your default editor is not VS Code, then you can reject these settings and pick your settings by yourself:

```

```

Once it is done, you are expected to pick an authentication method:

```

```

```

```

This will initialize your project for you, just sit back and relax in the meantime.

## Adding Amplify libraries and initializing auth flow

First thing that you need to do is to delete everything in the main.dart file. You will build everything from scratch.

You will start off by adding the amplify libraries and configuring those. Run the following command at your project’s root path:

```

```

This will add set of functions for you to configure Amplify from your application.

Next step is to add authentication library to the application:

```

```

Once you have the libraries, add the auth functionality to the configurations of the Amplify CLI:

> *Keep in mind that, the type of username used for signing in cannot be changed after creating a user pool (after running the command below once). If needed, first run* *amplify remove auth to delete the existing user pool, then follow the New Project flow on this page for enabling phone-number sign-in.*

```

```

The command above will take you through the setup process of the authentication capabilities. Follow each step as shown below:

```

```

```

```

After this, your changes are still considered to be on the local machine of yours. You need to push and publish your changes to your AWS account. For this, you will use the following command:

```

```

## Building the UI of the application

> *If you do not want to build the UI of your application for the authentication flow, you can always use the* [*Authenticator*](https://ui.docs.amplify.aws/flutter/components/authenticator) *library from AWS Amplify.*

Now your application is ready to handle **phone number** as **username** property in the sign in method. By default, email verification is enabled. If you would also like to use phone numbers for verifying users’ accounts, stick around here and you will learn about it as well.

It is time to start off writing some code! First call your main function to start your application:

```

```

```

```

Afterwards, create a StatelessWidget called SMSFlowExampleApp to have your application level settings.

```

```

```

```

One thing to notice here is that, you are enabling the [new Material Design properties](https://m3.material.io/) to use in your application. This way you can have a nice and modern look to your application.

Next step is to add SignUpScreen:

```

```

```

```

Now it is time for creating your text fields to enter information:

```

```

```

```

This text field will be a highly specific one. Once it is focused, it will automatically focus on to the next item when users submit the text.

Now use this widget alongside with a button to collect the user information for signing them up! Update the body in the SignUpScreen with the following:

```

```

Now if you run your application on a device, you should see a view similar to below:

![](https://cdn-images-1.medium.com/max/750/1*cpPDNp_SHZJKA-1niJr9aQ.jpeg)

All elements are wrapped with a ListView to embrace the fact that with keyboard is enabled or on smaller devices the fields can take much more place than you can allocate and being scrollable can help you wrap all view to be accessible to the users.

> *You will not be learning about form validation here. If you want to learn about form validation, you can* [*check the Flutter documentation*](https://docs.flutter.dev/cookbook/forms/validation) *for a tutorial.*

There are couple of ways to get the written text from the fields. You can get it by onFieldSubmitted or onChanged but these will require some additional work for us to keep the data. More straightforward approach is to use a TextEditingController. It is a special [ValueNotifier](https://api.flutter.dev/flutter/foundation/ValueNotifier-class.html) to keep a reference to any changes that is happening in a text input field and gives you access to the current text in the field any time you need it.

First thing you need to is to turn the SignUpScreen to a StatefulWidget. You can take advantage of your IDE for that. Go over the StatelessWidget text and show the options. That will help you to convert your widget in to a StatefulWidget.

![](https://cdn-images-1.medium.com/max/1024/1*A2VvN1O0oKyF-1DE6XyeMg.jpeg)

You have converted this widget into a StatefulWidget because ValueNotifier or ChangeNotifier are Listenableobjects notify any changes and pass it to its subscribers. Once they are created, they start to be active and they need to be disposed when they are not used. For this purpose, you will override the dispose method of the StatefulWidgetand only assign the values in the initState method:

```

```

Now assign those into the text input fields that you created before:

```

```

Last step before you pull in the Amplify topics is to get the texts from the fields. At onPressed method of the button that you created, get all the texts and be ready to use them:

```

```

## Adding Amplify Flutter library components

Now it is time to pull in the Amplify libraries:

```

```

```

```

```

```

The \_configureAmplify method adds the plugins that you are going to be using in your application and configure it for the Amplify libraries. You can name the method to anything that you would like and configure it the way that your application needs.

Adding a plugin is an asynchronous operation, you may call it at any place that you want. You can call it at the initState just before your UI is drawn or you can call it with helper widgets such as [FutureBuilder](https://api.flutter.dev/flutter/widgets/FutureBuilder-class.html) to handle the different states.

Go to your ListView that you have created before and wrap that widget with a FutureBuilder:

```

```

Next step is wiring up the sign up flow with phone number.

For more information about the AWS Amplify authentication libraries you can check the [official documentation](https://docs.amplify.aws/lib/auth/getting-started/q/platform/flutter/), ask your questions at [Amplify Discord](https://t.co/KE3BsVI4eb). You can also check the source code for this over [GitHub](https://github.com/salihgueler/amplify_sms_test) and if you have any questions regarding to the Amplify and Flutter topics, send it to me via DM on [Twitter](https://twitter.com/salihgueler)!

See you in the next post!

[View embedded media](https://media.giphy.com/media/l49FqlUguNsGDNCGk/giphy.gif)

Follow Flutter Community on Twitter: [https://www.twitter.com/FlutterComm](https://www.twitter.com/FlutterComm)
