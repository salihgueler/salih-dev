---
title: "Mastering AWS Amplify’s SMS Flows in Flutter — Part 1 : AWS Setup"
description: "Set up an AWS account and the Amplify CLI as the foundation for SMS authentication in a Flutter application."
pubDate: "2022-06-30T15:08:17.000Z"
updatedDate: "2022-07-18T00:56:33.542Z"
category: "Flutter"
tags: ["amplify","mobile-app-development","flutter","flutter-app-development","aws"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*yo-9ojR9g9dWO3EyQ0Iipw.png"
  alt: "Cover image for Mastering AWS Amplify’s SMS Flows in Flutter — Part 1 : AWS Setup"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf"
aiSummary: "Set up an AWS account and the Amplify CLI as the foundation for SMS authentication in a Flutter application."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf"}]
draft: false
---

## Setting up AWS accounts for AWS Amplify

To secure authentication flows, developers need to implement additional security options to their applications. One of the most common use-cases that serves this purpose is to add an SMS verification/approval flow to the application.

In order to use SMS for verification flows, customers can provide their phone number through the following ways:

-   **As a username**: Users login with a username and password where their phone number acts as the username.
-   **As a verification method**: Users login using a username, email or phone number, but must verify their account with an OTP (one time password) sent to their phone.
-   **MFA (Multi-Factor Authentication)**: Users must verify every login with an OTP sent to their phone.

In the span of this blog post series, you will be learning:

-   [Creating an AWS Account](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf) (Current post)
-   [Setting up Amplify CLI on your machine](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf) (Current post)
-   [Creating a new Flutter project from Flutter CLI tool](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Initializing the AWS Amplify project by using Amplify CLI into your Flutter project](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Implementing a sign up flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7)
-   [Implementing a sign in flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18)

## Requirements

-   Install the latest Flutter version (or at least 2.10,0+). If you do not have the Flutter setup, follow [the instructions over flutter.dev](https://docs.flutter.dev/get-started/install) for your operating system.
-   Setup your preferred IDE by installing Flutter and Dart plugins. You can check [the official documentation](https://docs.flutter.dev/get-started/editor) for further information.
-   Install the below tools for setting up Amplify CLI at later stage
-   [Node.js](https://nodejs.org/) v14.x or later
-   [npm](https://www.npmjs.com/) v6.14.4 or later
-   [git](https://git-scm.com/) v2.14.1 or later

If you have the requirements ready, you can start!

[View embedded media](https://media.giphy.com/media/BpGWitbFZflfSUYuZ9/giphy.gif)

## Creating an AWS Account

> *You can either follow the step by step guide below or check the* [*official documentation*](https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/) *to create and activate your AWS account from the* [*aws.amazon.com*](http://aws.amazon.com/)

For your AWS Amplify or any AWS related applications you are expected to have an AWS account. Go to aws.amazon.com, and click on the **Complete Sign Up** button on the top right corner.

![](https://cdn-images-1.medium.com/max/1024/1*oTWA9HS5h5c6VY2y3rualQ.jpeg)

That will direct you to a page to login or give you an option to create an AWS account with **Create a New AWS Account**. Click on the button and start the process of creating AWS Account.

![](https://cdn-images-1.medium.com/max/1024/1*aFCXzmxAn30mEkF7jknlyQ.jpeg)

Enter your email address and create a unique account name. After you entered the necessary information, click on the **Verify email address** button to move forward.

Now you will receive an activation code with your email address. You should enter that in the next page and continue. After verification, you will be directed to the password setting page:

![](https://cdn-images-1.medium.com/max/1024/1*FMB-pVHIKadgYIg_645XmQ.jpeg)

After you setup a password, now you need to enter and submit your profile information:

![](https://cdn-images-1.medium.com/max/1024/1*ou48nwrb0TeZT8U2D5t0Cw.jpeg)

Once you are done with setting up your personal information, you need to enter a payment method. **Please keep in mind that, you will not be charged for anything at this point. $1 will be deducted and then refunded to your account to verify your account.**

Afterwards, you are done with adding the payment method. Confirm your identity by entering the verification code that has been sent to the phone number information you have entered.

![](https://cdn-images-1.medium.com/max/1024/1*o4LUDjos9FDPMAUchqPL-A.jpeg)

Once you are done with the confirmation, now it is time to select the account tier that you would like to use.

![](https://cdn-images-1.medium.com/max/1024/1*Bek84XrAZIR3pXE8zT7v9w.jpeg)

Continuing with the Free Tier should be sufficient for moving forward with the tutorial.

After that, click on the **Complete sign up** button and it will take you back to the login page. Login with the account information that you created and reach to the console.

![](https://cdn-images-1.medium.com/max/1024/1*o9Dv0tSp9kxcoCGF5_2v4g.jpeg)

## Setting up Amplify CLI on your machine

You can install the Amplify CLI tool with either NPM or cURL. For NPM you can use the following command:

```

```

If you want to use cURL, you can do the following:

```

```

```

```

Once you run these commands, it will add the amplify command globally so you can use it in either new projects or with the projects that you already have.

You now need to setup your AWS account using the Amplify CLI. For that, you need to run the following command in your terminal:

amplify configure

The CLI will direct you to a page to login to the AWS Console. Login to the console if you have not already. Then, go back to the terminal and click on **Enter** to continue. Once you are signed in, Amplify CLI will ask you to create an IAM user, select the region that is the best for you (For more information about the regions, you can check the [Regions and Zones](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html) document). After that continue user creation over the AWS Console by adding user details. After that click on next and go to policy screen:

![](https://cdn-images-1.medium.com/max/1024/1*jZ04fDJTZ5epAGCCOjDp6A.jpeg)

Make sure to select AdministratorAccess-Amplify as a policy to enable your IAM account to have Admin access over your Amplify projects.

After this step, click on **Next** buttons until you reach the access information. Do not close these windows and go back to the terminal.

```

```

Fill the information above by copying and pasting the key and id that you have. Lastly, create a profile on your local machine (you can just click Enter and accept default) and you are done with the setup!

```

```

[Next step is setting up your Flutter project with Amplify](https://medium.com/flutter-community/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6).

For more information about the AWS Amplify authentication libraries you can check the [official documentation](https://docs.amplify.aws/lib/auth/getting-started/q/platform/flutter/), ask your questions at [Amplify Discord](https://t.co/KE3BsVI4eb). You can also check the source code for this over [GitHub](https://github.com/salihgueler/amplify_sms_test) and if you have any questions regarding to the Amplify and Flutter topics, send it to me via DM on [Twitter](https://twitter.com/salihgueler)!

See you in the next post!

[View embedded media](https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif)

Follow Flutter Community on Twitter: [https://www.twitter.com/FlutterComm](https://www.twitter.com/FlutterComm)
