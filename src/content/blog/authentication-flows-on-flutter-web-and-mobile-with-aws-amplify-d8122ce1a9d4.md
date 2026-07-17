---
title: "Authentication flows on Flutter Web and Mobile with AWS Amplify"
description: "Build authentication flows that work across Flutter mobile and web applications using AWS Amplify."
pubDate: "2022-08-26T16:02:37.000Z"
updatedDate: "2022-09-12T02:56:40.183Z"
category: "Flutter"
tags: ["mobile-app-development","flutter-app-development","aws","flutter","aws-amplify"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*ZBcHJhrwP6LtFN_bveZPRA.png"
  alt: "Cover image for Authentication flows on Flutter Web and Mobile with AWS Amplify"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/authentication-flows-on-flutter-web-and-mobile-with-aws-amplify-d8122ce1a9d4"
aiSummary: "Build authentication flows that work across Flutter mobile and web applications using AWS Amplify."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/authentication-flows-on-flutter-web-and-mobile-with-aws-amplify-d8122ce1a9d4"}]
draft: false
---

With AWS Amplify Authentication libraries going Developer Preview, now developers are able to target not only iOS and Android but also Web and Desktop!

In this tutorial you will be implementing a responsive authentication and sign up targeting the web platform with Flutter:

![Animated GIF of an authentication flow on iOS and Web](https://cdn-images-1.medium.com/max/800/1*hzGb9jz5tA_Gqv_aXhDFxg.gif)

This tutorial will walk you through building these flows and features:

-   Register a user
-   Confirm a user
-   Log in with a user
-   Show user information
-   Update user information
-   Delete a user
-   Log out with a user

**Requirements**

-   Configured Amplify CLI, if you do not have it yet check out the [official docs](https://docs.amplify.aws/start/getting-started/installation/q/integration/flutter/)
-   Starter project from [GitHub](https://github.com/salihgueler/amplify_custom_authentication_flows/tree/starter)

## Starter Project

Clone or download this starter project from [GitHub](https://github.com/salihgueler/amplify_custom_authentication_flows/tree/starter). This project holds the scaffold of the project with the prepared navigation and ui components.

First of all, do not mind the Dart Analysis warnings, you will fix all of them at the end of the tutorial. Next, let’s go through the project structure:

-   **utils** folder keeps the utility widgets, classes and variables that is used through the application. For example, you can find the logging and routing information there.
-   **auth** folder and its sub-folders keeps the widgets for the authentication related operations such as login, register and user confirmation
-   **home** folder keeps the widgets for the screen that comes after login

From now onwards all the file name references and method names will be referenced according the starter project.

## Initializing Amplify Project

For adding AWS Amplify libraries to your project, you need to:

-   Initialize the project with AWS Amplify CLI
-   Add Amplify libraries to your project

**Initialize the project with AWS Amplify CLI**

First of all you need to type amplify init to your terminal at the root folder of your project. You will be prompted to pick a project name and configurations, you can pick the default ones and continue or, you can select your own options as well.

After the amplify project is initialized, run amplify add auth command on the same folder. Select the Default Configuration for the authentication and security configuration and username for the authentication strategy.

After you are done with this step, final thing to do is to push your project to the cloud by running amplify push. This operation might take couple of minutes. Once it is done, your Amplify CLI setup is ready. Let's add the libraries to the project now.

**Add Amplify libraries to your project**

For adding Web support to your project, you need to have the Developer Preview version of the Amplify libraries in your project.

For having the latest developer preview versions of the libraries, go to the [pub.dev](http://pub.dev) and get the latest version of the [amplify\_flutter](https://pub.dev/packages/amplify_flutter/versions#prerelease) and [amplify\_auth\_cognito](https://pub.dev/packages/amplify_auth_cognito/versions#prerelease) libraries.

Open your pubspec.yaml file in your project and add the following and run flutter pub get:

Now the final step is to add the configurations to the application. Open main.dart file and update the main function as follows:

-   (1): Turned the **main** function to an asynchronous function to be sure that Amplify configurations happen before the app runs
-   (2): For running the Amplify configuration, you are expected to have widgets binding in place. This code ensures that it is initialized
-   (3): Create the plugin object and add it to Amplify
-   (4): After the plugins are added, now the generated configuration variable can be called to prepare the application
-   (5): An error might happen, you catch it here and log it with the logger from the utils. In an ideal scenario you should also report this with crash reporting mechanisms.

Setup of Amplify CLI and Amplify libraries is over now. Now it is time to implement the features.

## Signing Up a User

If you run the starter project, you should see the application below:

![Register screen on a browser with username, email, password fields](https://cdn-images-1.medium.com/max/1024/1*SPPeGcQA9fxSXT6HO6wvkw.png)

But, it won’t be functioning right now. Because the \_signUpUser function in the sign\_up\_screen.dart file is empty. First thing that you want to do is to be sure that all the fields are properly filled in:

After the form is validated, now it is time to right some code to sign up users.

This code is enough to sign your user up. But this does not have any confirmation or error case handling that might occur. First let’s add some error handling to listen for the expected errors might occur.

With the changes above you have:

-   (1): Set the loading indicator to true to let the users know something is happening. Also, any earlier error messages are removed.
-   (2): Go to the user confirmation page if the sign up is successful and next step is confirmation.
-   (3): Be sure to confirm asynchronous functions to have an alive widget to do navigation with the current context
-   (4): Set the loading indicator to false
-   (5): Reset all the fields to empty
-   (6): Check the error type and handle if it is an expected error and send user a meaningful error message.

Now time to confirm the user.

## Confirm a User

![User confirmation page on a browser with a confirmation code field and button](https://cdn-images-1.medium.com/max/1024/1*_AZdVdgpNsaHSb1oM8wngQ.png)

After the user is created, the user should receive an email with a confirmation code. This code will be used to confirm the user’s registration.

Go to the \_confirmUser method in the confirm\_user\_screen.dart file.

> *The confirmation page is a multi purpose page to handle different scenarios to be used. That is why you might realise that an empty email confirmation method is there. You will implement that functionality at later steps.*

Update the method with the following:

As you can see, the pattern is similar to what has been done earlier:

-   (1): confirmSignUp function from the Amplify libraries and returns the sign up information
-   (2): Remove the loading indicator that has been set before and go to sign in page
-   (3): Navigate to sign in page if the sign up is complete
-   (4): Check the error type that you are aware of and handle it. If it is an expected error send user a meaningful error message.

Now it is time to write the code for logging in.

## Log In with a User

In the starter project, if you go to sign\_in\_screen.dart you can see that it is the only build method that is almost empty. The reason is that, you will be implementing two operations here:

-   Checking if a user is already logged in and if they do, navigate the user to the home screen
-   Logging in the user

**Checking if a user is already logged in**  
Go to sign\_in\_screen.dart and go to build method. Remove the SizedBox under // Add sign in code comment and update the build method as follows:

-   (1): Add a FutureBuilder to handle the asynchronous reading of the auth session status.
-   (2): Amplify.Auth.fetchAuthSession() returns the status of the authentication for the user as a future
-   (3): FutureBuilder calls the builder function on connection state changes/data retrieval. You show what you want to show after the data is fetched on this if statement
-   (4): On the else statement you should show any loading indicators that you find useful.

> *You can also handle the error state here with* *snapshot.hasError value.*

Now add the login ui elements instead of the SizedBox that was added before:

If you run the application now, you should see the following:

![Username and password with a button on a browser](https://cdn-images-1.medium.com/max/1024/1*0FKOzN0f61A_ursMHClZ1A.png)

Now it is time to add the logic to log in the user. Update the \_loginUser method with the following:

You can see the pattern of error handling and success result matches the previously implemented features:

-   (1): Validate the form elements to be sure they are not empty or they follow the rules of the authentication
-   (2): Amplify.Auth.signIn returns a SignInResult to do the sign in operations
-   (3,4): The result can have several results
-   (3) It can detect if the sign in was successful
-   (4) Detect if the user requires an additional step like user confirmation according to the state of the user
-   (5): Let the user know about it, if the user is not found
-   (6): Direct user to the confirmation page, if the user is not confirmed,
-   (7): Let the user know if the password or username is wrong

Before you continue to the next step, update the default path from utils/routes.dart file. Now it directs users to sign-up first but it should direct them to sign-in.

## Show User Information

After users are logged in, they are directed to the home page. At this page, they will be able to see the logged in user information.

Go to the home\_screen.dart file and add the following code instead of the // Add User attribute call comment:

The code above does the following:

-   (1): Amplify.Auth.fetchUserAttributes fetches the current logged in user’s attributes. The call is an async function and returns a Future.
-   (2): Maps the list of attributes returned and maps them into the widgets
-   (3): *You will add a way to update email later on*, this code checks if the email change is verified and if not, the users should be able to go to confirmation page with a click
-   (4): Show the key and value of the user attributes as Text widget
-   (5): Show progress indicator while the app fetches user attributes

## Update User Information

When you run the application now and login with your account, you can see the user information like below.

![Home page with primitive user information and “delete user”, “update password”, “update email” and “log out” buttons](https://cdn-images-1.medium.com/max/1024/1*ol8tg2nRvCC-9BhgspMM_A.png)

You can also see two buttons to update the email and the password. These two are different operations for Amplify. Users can update any information regarding to their account. They can update name, birthday, email and many more user attributes.

You will add the email update because it requires a step of confirmation to update this information. Email update requires a verification because the email attribute is an essential attribute for the users while registering.

Now go to the person\_operations\_widget.dart file and update the \_updateEmail method as follows:

-   1): Check if the email update widget is enabled and the email field is valid
-   (2): Amplify.Auth.updateUserAttribute is a future and returns information about the update
-   (3): Checks for the next step of the attribute update. If it does not require any verification, the update happens automatically.
-   (4): Enables the email update widget

Now you need to update the confirmation page to handle email changes. Go to confirm\_user\_screen.dart file and update the \_confirmEmailAddress method:

A user’s password is not an attribution of the user. That is why it has a different function that is doing that task. Go to the person\_operations\_widget.dart file and update the \_updatePassword method as follows:

With the changes above, your users are able to change their passwords. Here are the key changes from above:

-   (1): Check if the password update widget is enabled and the email field is valid
-   (2): Amplify.Auth.updatePassword calls the Amplify to update the password
-   (3): Inform users when there is a known error, and if there isn’t log the error directly
-   (4): Enables the password update widget

## Delete a User

In most of the applications, developers give users a quick way to delete their accounts. You can also do that by using Amplify Authentication library.

Go to the person\_operations\_widget.dart file and update the \_deleteUser method as follows:

This code deletes the user and when the deletion successful directs them to the sign in screen.

## Log Out a User

If you go and update the end of your URL on the browser with */sign-in* instead of *home* you can see that a check that you have added before will direct you to the home page again.

This happens because the user is signed in on the browser. If you want to reach to the sign in page again, you need to log out the current user.

Go to the home\_screen.dart file and update the \_logOutUser method as follows:

## Conclusion

Now that with its Developer Preview AWS Amplify supports Mobile, Web and Desktop, you can implement a fully functional authentication flow over all Flutter supported platforms. You can take full advantage of the power and have Amplify handle the complexities of the authentication flows for you this way you can focus on making the application UI pixel perfect.

You may reach out the latest source code from [GitHub](https://github.com/salihgueler/amplify_custom_authentication_flows). Also, for more information about the AWS Amplify libraries you can check the [official documentation](https://docs.amplify.aws/start/q/integration/flutter/?sc_icampaign=flutter-start&sc_ichannel=docs-home), if you have any questions regarding to the Amplify and Flutter topics you can either ask it at [Amplify Discord](https://t.co/KE3BsVI4eb) or send it to me via DM on [Twitter](https://twitter.com/salihgueler)!

Follow Flutter Community on Twitter: [https://www.twitter.com/FlutterComm](https://www.twitter.com/FlutterComm)
