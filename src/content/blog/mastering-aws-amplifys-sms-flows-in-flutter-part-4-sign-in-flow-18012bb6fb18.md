---
title: "Mastering AWS Amplify’s SMS Flows in Flutter — Part 4: Sign In Flow"
description: "Complete an AWS Amplify SMS authentication flow in Flutter by implementing phone-number sign-in."
pubDate: "2022-06-30T15:08:33.000Z"
updatedDate: "2022-07-18T00:54:36.131Z"
category: "Flutter"
tags: ["aws","amplify","flutter","flutter-app-development","mobile-app-development"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*9kQmHBRPDhD8Glzaq2Qv8g.png"
  alt: "Cover image for Mastering AWS Amplify’s SMS Flows in Flutter — Part 4: Sign In Flow"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18"
aiSummary: "Complete an AWS Amplify SMS authentication flow in Flutter by implementing phone-number sign-in."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18"}]
draft: false
---

## Sign in with SMS by using Amplify Flutter

So far, you were able to set up your Flutter project with AWS Amplify and create a sign up flow. Now it is time to learn how you can sign users in to your application.

In the span of this blog post series, you will be learning:

-   [Creating an AWS Account](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Setting up Amplify CLI on your machine](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Creating a new Flutter project from Flutter CLI tool](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Initializing the AWS Amplify project by using Amplify CLI into your Flutter project](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Implementing a sign up flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7)
-   [Implementing a sign in flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18) (Current post)

[View embedded media](https://media.giphy.com/media/3orif4alyHEpIZAr0A/giphy.gif)

## Sign in users with phone number and phone number confirmation (MFA)

### Enable MFA for the project

MFA cannot be unconditionally enabled for all users after creating a user pool. If you want to enable MFA for your ongoing project, it will be marked as “Optional” for users. In this mode, MFA must be enabled on a user-by-user basis, either through an Admin SDK (e.g. via a Lambda trigger as part of the sign-up process), or manually in the Cognito console.

If you’d like to make MFA required for users, you must first delete your auth resource by running amplify remove auth, then re add the auth.

You will learn how to remove and re-add the auth to enable MFA for all users at this step:

```

```

```

```

Once it is removed, re add the auth again like you did before:

```

```

Only difference that you did with settings is to receive an authentication code for your sign in. Now that you have it, it is time for you to implement the UI.

### Implement UI for the sign in page

You will be using the same components that you have created before, only for the Sign In this time.

Create a StatefulWidget named SignInScreen:

```

```

```

```

```

```

Now update the build method with the following:

```

```

You might realize that, you still have \_configureAmplify for configuring the Amplify libraries. This should be used only when the Amplify libraries are not configured before. Otherwise all the FutureBuilder can be removed with it.

It is time to add the TextEditingController like you did before. Use the same pattern has been used in the SignUpScreen.

Now it is time to create the \_signInUser method in the SignInScreen:

```

```

Now if you run the application, you can see that, the MFA is enabled for signing in the user.

This sums up what you can do with your phone number by using authentication libraries of AWS Amplify. Now that you are able to:

-   Login with phone number,
-   Verify the user with phone number,
-   Do MFA with phone number.

You can securely authenticate users in to your application now by using SMS flows.

For more information about the AWS Amplify authentication libraries you can check the [official documentation](https://docs.amplify.aws/lib/auth/getting-started/q/platform/flutter/), ask your questions at [Amplify Discord](https://t.co/KE3BsVI4eb). You can also check the source code for this over [GitHub](https://github.com/salihgueler/amplify_sms_test) and if you have any questions regarding to the Amplify and Flutter topics, send it to me via DM on [Twitter](https://twitter.com/salihgueler)!

[View embedded media](https://media.giphy.com/media/DhstvI3zZ598Nb1rFf/giphy.gif)

Follow Flutter Community on Twitter: [https://www.twitter.com/FlutterComm](https://www.twitter.com/FlutterComm)
