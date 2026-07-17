---
title: "Optimizing Authentication Flows with TOTP using AWS Amplify and Flutter for Improved Security"
description: "Add time-based one-time password authentication to a Flutter application with AWS Amplify for a stronger sign-in flow."
pubDate: "2023-09-07T15:10:56.000Z"
updatedDate: "2023-10-13T15:41:34.699Z"
category: "Flutter"
tags: ["flutter-development","aws","authentication","totp","flutter"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/0*unp-utlW7yg3mEZM"
  alt: "Cover image for Optimizing Authentication Flows with TOTP using AWS Amplify and Flutter for Improved Security"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/optimizing-authentication-flows-with-totp-using-aws-amplify-and-flutter-for-improved-security-18e56d2a110"
aiSummary: "Add time-based one-time password authentication to a Flutter application with AWS Amplify for a stronger sign-in flow."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/optimizing-authentication-flows-with-totp-using-aws-amplify-and-flutter-for-improved-security-18e56d2a110"}]
draft: false
---

In today’s digital world, protecting user data is crucial. To enhance security, many applications are adding extra security steps like MFA **(Multi-factor Authentication)** by using SMS or TOTP (**Time-based One-Time Passwords)**.

[AWS Amplify](https://docs.amplify.aws/lib/q/platform/flutter/) has already supported SMS MFA for some time now but with the version [1.4.0](https://github.com/aws-amplify/amplify-flutter/releases/tag/v1.4.0), it now also supports TOTP with Flutter libraries.

![](https://cdn-images-1.medium.com/max/1018/1*lxZeFeU9Nu0M15ww5PyX6A.png)

Screenshot of version 1.4.0 of Amplify Flutter libraries.

In this tutorial, you’ll discover how to create a sign-in/up process using TOTP. We’ll be implementing this on the starter project available on [GitHub](https://github.com/salihgueler/totp_sample_app/tree/starter_project).

> To simplify things, the AWS Amplify team has developed a package called [Amplify Authenticator](https://ui.docs.amplify.aws/flutter). With this tool, you just need to set up authentication details using the Amplify CLI, and the UI will handle the rest for you.  
>   
> You can find more information in [this blog](https://aws.amazon.com/blogs/mobile/aws-amplify-totp-support-for-mfa-on-android-swift-flutter/) post on creating a sign-in/up process with TOTP using the UI library.

You can watch the video below to see how the final implementation behaves. You can also review the completed code on [GitHub](https://github.com/salihgueler/totp_sample_app).

::youtube{id="PRNx-PHTIxE" title="Embedded video"}

> For this project, you should have an AWS Account and have the Amplify CLI set up. You can follow the instructions in [this documentation](https://docs.amplify.aws/lib/project-setup/prereq/q/platform/flutter/) to setup the Amplify CLI.

Let’s get started!

[View embedded media](https://media.giphy.com/media/kI4K8nj6gCadlTYPNF/giphy.gif)

## Initializing the Amplify Project

To begin the implementation, start by cloning the starter project from GitHub.

```

```

Once you’ve cloned the project, navigate to its root folder and run the command amplify init.

```

```

Running amplify init will initialize your project. Follow the CLI prompts and accept the default settings to proceed:

```

```

Now, let’s add authentication capabilities using the Amplify CLI. Run the command amplify add authand select the **Manual Configuration** option. Follow the prompts and choose your answers as follows:

```

```

In the provided CLI flow:

-   Username sign-in is enabled.
-   Email is required for activating accounts and managing forgot password options.
-   Multi-factor authentication for sign-in is enabled using TOTP.
-   All other custom options are rejected, keeping the authentication process straightforward and secure.

Now, run amplify push -y to push the changes to the cloud.

```

```

Now it is time to write some Dart code.

## Configure Amplify Libraries

The first step in configuring Amplify Libraries is to add the required libraries. To do this, add the following to your *pubspec.yaml* file and then run flutter pub get:

```

```

Once you’ve added the required libraries, navigate to your *main.dart* file and update the //TODO: Configure Amplify with the following:

```

```

Last, update the main function by replacing // TODO: Call \_configureAmplify line with the following:

```

```

Now you are ready to use the libraries.

[View embedded media](https://media.giphy.com/media/bkvdYeBEGeSE8/giphy.gif)

## Implementing Sign Up

To begin, open the *sign\_up\_user.dart* file and replace the // TODO: Implement signUpUser function:

```

```

With the provided code:

-   You are signing up the user.
-   Providing feedback on the sign-up state.

To use the created functions, find the // TODO: Call signUpUser function section and replace all the content of the anonymous function with the following code:

```

```

The code above performs the following tasks:

-   Calls the previously created functions.
-   In case of an exception, it notifies the user with a snack bar.
-   It updates the state of the button during and after the processes.

Now that you have the sign-up capability, you also need to implement account verification. Open the *email\_verification\_page.dart* file and locate the // TODO: Call confirmSignUp function section. Replace all the content of the anonymous function with the following code:

```

```

The provided code will confirm the user if the confirmation code is correct, ensuring that the user’s account is properly verified.

In case the user loses the code, it’s a common practice to provide a button to resend the code. To implement this feature, find the // TODO: Call resendSignUpCode function section in your code and replace it with the following:

```

```

The provided code will resend the sign-up code to the user’s email address if needed. The sign-up process is now complete, and it’s time to move on to the sign-in functionality.

[View embedded media](https://media.giphy.com/media/Rd6sn03ncIklmprvy6/giphy.gif)

## Implementing Sign In

To proceed with the sign-in implementation, open the *sign\_in\_page.dart* file and locate the // TODO: Add signInWithCognito section. Replace it with the following code:

```

```

These are the three important points to note:

-   If the user hasn’t set up TOTP yet, they will be directed to a page to set it up.
-   If the user has TOTP set up, they will be directed to the verification code page before signing in.
-   If the user’s account hasn’t been verified yet, they will be directed to the verification page.

Now, to continue with the sign-in implementation, find the // TODO: Call signInWithCognito function section and replace all the content of the anonymous function with the following code:

```

```

With this change, you are calling the sign-in function you created. If the sign-in fails, it displays an appropriate error message. Otherwise, it directs the user to the TOTP page.

## Implementing TOTP

[View embedded media](https://media.giphy.com/media/ZTUfoXigKRpCM/giphy.gif)

Now, it’s time to implement the TOTP feature you’ve been waiting for! TOTP, or Time-based One-Time Passwords, is a widely used form of two-factor authentication (2FA) that generates unique numeric passwords based on the current time.

For setting up TOTP for your application you need a companion authenticator app like [Microsoft Authenticator](https://www.microsoft.com/en/security/mobile-authenticator-app), [Google Authenticator](https://support.google.com/accounts/answer/1066447?hl=en&co=GENIE.Platform%3DAndroid) or [Authy](https://authy.com/). TOTP codes are communicated between the authenticator app and the service or platform that requires authentication through a shared secret key.

This secret key is initially exchanged and stored securely when the user sets up two-factor authentication. The authenticator app uses this secret key, along with the current time, to generate a time-sensitive one-time password (OTP). The user then enters this OTP into the service or platform, which also uses the shared secret key to independently calculate the expected OTP. If the entered OTP matches the expected value, authentication is successful. This way, both the authenticator app and the service can verify the user’s identity without needing to communicate directly, making it a secure and convenient method for two-factor authentication.

To set up TOTP, open the *totp\_setup\_page.dart* file and locate the // TODO: Call confirmSignIn function section. Replace all the content of the anonymous function with the following code:

```

```

With this change, you are collecting the 6-digit code, and if it doesn’t result in an error, it directs you to the home page.

Regarding adding verification to the page, you don’t need to take any additional steps for that. Simply open the *totp\_verification\_page.dart* file and replace all the content of the anonymous function that contains the // TODO: Call confirmSignIn function line with the same code as mentioned above.

## Cherry on top

[View embedded media](https://media.giphy.com/media/DyoNwtn8yGNft3Mz5n/giphy.gif)

To have a fully implemented authentication flow, it’s important to obtain the current authentication status and implement sign-out functionality.

To add sign-out functionality to the *home\_page.dart* file, locate the // TODO: Call signOut function section and update the anonymous function as follows:

```

```

This code will sign out the current user and redirect them to the sign-in page.

To complete the last step of checking the authentication status of the user, navigate to the *splash\_page.dart* file and update the \_checkAuthStatus function as specified.

```

```

## Conclusion

In summary, our authentication setup emphasizes both user security and usability. It has username sign-in for simplicity while mandating email use for account activation and password recovery.

We’ve improved thesecurity through Multi-factor Authentication (MFA) with Time-based One-Time Passwords (TOTP), as an extra verification layer. Customization options have been streamlined to maintain clarity. You can check out our open-source project over [GitHub](https://github.com/salihgueler/totp_sample_app).

For deeper insights into authentication and security, explore additional resources:

-   Twilio TOTP [documentation](https://www.twilio.com/docs/glossary/totp).
-   TOTP Algorithm over [Wikipedia](https://de.wikipedia.org/wiki/Time-based_One-time_Password_Algorithmus).
-   Amplify [Documentation](https://docs.amplify.aws/lib/auth/mfa/q/platform/flutter/#setting-up-totp-for-a-user) for TOTP.

To connect with me and stay updated on similar topics, follow me over social media with the links below!

-   [Twitter](https://twitter.com/salihgueler)
-   [LinkedIn](https://www.linkedin.com/in/salihgueler/)
-   [YouTube](https://youtube.com/@salihgueler)
