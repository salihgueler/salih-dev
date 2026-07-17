---
title: "Mastering AWS Amplify’s SMS Flows in Flutter — Part 3: Sign Up Flow"
description: "Implement phone-number sign-up and SMS verification in Flutter with AWS Amplify authentication."
pubDate: "2022-06-30T15:08:28.000Z"
updatedDate: "2022-07-06T13:20:18.798Z"
category: "Flutter"
tags: ["mobile-app-development","aws","flutter-app-development","amplify","flutter"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*2yyoC54YD1mrLRJw9Vaiiw.png"
  alt: "Cover image for Mastering AWS Amplify’s SMS Flows in Flutter — Part 3: Sign Up Flow"
  credit: "Medium"
  creditUrl: "https://itnext.io/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7"
aiSummary: "Implement phone-number sign-up and SMS verification in Flutter with AWS Amplify authentication."
sources: [{"name":"Medium","url":"https://itnext.io/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7"}]
draft: false
---

## Sign up with SMS by using Amplify Flutter

In the earlier parts of this blog post series, you learned about creating an AWS account, creating a Flutter project and setting up AWS Amplify for your Flutter project.

Now it is time to implement sign up flows!

In the span of this blog post series, you will be learning:

-   [Creating an AWS Account](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Setting up Amplify CLI on your machine](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-1-aws-setup-ef748798fdbf)
-   [Creating a new Flutter project from Flutter CLI tool](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Initializing the AWS Amplify project by using Amplify CLI into your Flutter project](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-2-project-setup-5197b77317a6)
-   [Implementing a sign up flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-3-sign-up-flow-d62858f9ebc7) (Current post)
-   [Implementing a sign in flow with phone number](https://medium.com/@muhammedsalihguler/mastering-aws-amplifys-sms-flows-in-flutter-part-4-sign-in-flow-18012bb6fb18)

[View embedded media](https://media.giphy.com/media/6FrujVG4mafRETQTal/giphy.gif)

## Sign up users with phone number and email confirmation

In the onPressed method, you will be calling Amplify.Auth.signUp method. This will help you to sign up the users but there are some rules to keep in mind:

-   Email verification is enabled by default for all cases (unless it is chosen otherwise), therefore you are required to provide an email address in this case
-   If you do not want to have email verification, you need to enable phone verification
-   Phone number will be passed as username in this case.

```

```

The method will check if the users have:

-   a phone number as username,
-   phone number should have the country code alongside it
-   a proper email address,
-   a long password (minimum 8 characters)

Otherwise, it will not sign the user up. So it is a good practice to let the user know about these requirements.

When the account needs to be confirmed, users now will be seeing a dialog to enter their confirmation code. The code will be sent to the email address with this iteration.

![](https://cdn-images-1.medium.com/max/750/1*ZV29sr8HI2wHBoEFv_rXKA.jpeg)

Now add the confirmation flow:

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

Once the code is entered, you can check your user console by writing amplify console auth to the terminal and see the confirmation status as follows:

![](https://cdn-images-1.medium.com/max/1024/1*H_z9jHZ3nyZPkYAOOFhV_g.jpeg)

Now that you created the full signup flow, it is time to do the confirmation with the phone number!

## Sign up users with phone number and phone number confirmation

First of all, start off by removing the email address verification and adding phone number verification:

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

```

```

Now push your changes to the cloud by amplify push , and go back to your code.

```

```

> *Be mindful that this does not mean you do not need email address. For verifying user information, Amplify either asks for an email address or bunch of personal information e.g. name, surname etc. For the sake of simplicity you will continue with email here.*

If you run the application again and register a user, now you will not receive an email. But you will not also receive an SMS yet, because you have not set up a system to send messages yet.

Once you have enabled the SMS based auth workflow, if you looked carefully in your debug console you might remember seeing an error message like below:

```

```

Amplify uses a **Simple Notification Service (SNS)** for providing message delivery service from publishers to subscribers. For sending SMS messages it is required to have an account on the Amazon SNS.

### Registering phone numbers for special request countries

Go to the [Amazon SNS messaging page](https://console.aws.amazon.com/sns/v3/home#/mobile/text-messaging) and before you do anything else, check if you have a warning like below at the top of the page:

![](https://cdn-images-1.medium.com/max/1024/1*JhFBy8EcMmKZxaMZC3K8iw.jpeg)

If you do, this means for some countries you are expected to origination numbers to send the messages, but if you don’t that is good news for you and you can skip to the **Registering phone numbers for sandbox destination** section.

Now click on the **View origination numbers** button. It will direct you to the [Origination Numbers Console](https://eu-west-3.console.aws.amazon.com/sns/v3/home#/mobile/origination-identities). You can either check the numbers you have there or create a new number by clicking the **Provision numbers in Pinpoint** button.

![](https://cdn-images-1.medium.com/max/1024/1*EepuFB4dOcSNxXdyxWWORA.jpeg)

That will take you to the Amazon Pinpoint page to add numbers. If your country does not support sender IDs, you must purchase an origination number. In Pinpoint, click on **Request phone number**. This will bring you to a page where you can obtain a Toll-free number for sending SMS messages. Choose the country from which you’ll be sending SMS messages, then follow the prompts for requesting a new number. After successfully requesting a toll-free number, you can return to SNS to verify your phone number like described at the next section.

![](https://cdn-images-1.medium.com/max/1024/1*-UCDKEUDvfvZLujdBmb9Zw.jpeg)

### Registering Sender IDs for special request countries

If the country you are supporting is not part of the phone numbers list, then you can check the list of [countries](https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-countries.html) here to see the requirements. E.g. some countries like Turkey require a sender registration. Senders are required to use a pre-registered alphabetic Sender ID. In SMS messaging, a *sender ID* is a name that appears as the message sender on recipients’ devices. Support for sender IDs varies by country. For example, carriers in the United States don’t support sender IDs at all, but carriers in India require senders to use sender IDs.

> *If you need to register a sender ID in India, complete the procedures in* [*Special requirements for India*](https://docs.aws.amazon.com/pinpoint/latest/userguide/channels-sms-senderid-india.html) before*you open a case in Support Center.*

Go to the [Service Limit Increase support page](https://us-east-1.console.aws.amazon.com/support/home#/case/create?issueType=service-limit-increase):

![](https://cdn-images-1.medium.com/max/1024/1*-x6qPic_YGYMlB8R-RokhQ.jpeg)

-   For **Limit type**, choose **Pinpoint SMS**.
-   (Optional) For **Provide a link to the site or app which will be sending SMS messages**, provide information about the website, application, or service that will send SMS messages.
-   (Optional) For **What type of messages do you plan to send**, choose the type of message that you plan to send using your long code:
-   **One Time Password** — Messages that provide passwords that your customers use to authenticate with your website or application.
-   **Promotional** — Noncritical messages that promote your business or service, such as special offers or announcements.
-   **Transactional** — Important informational messages that support customer transactions, such as order confirmations or account alerts. Transactional messages must not contain promotional or marketing content.
-   (Optional) For **Which AWS Region will you be sending messages from**, choose the region that you’ll be sending messages from.
-   (Optional) For **Which countries do you plan to send messages to**, enter the country or region that you want to purchase short codes in.
-   (Optional) In the **How do your customers opt to receive messages from you**, provide details about your opt-in process.
-   (Optional) In the **Please provide the message template that you plan to use to send messages to your customers**field, include the template that you will be using.

After that, fill in the request information like below (You may pick the **Region** based on the region you prefer):

![](https://cdn-images-1.medium.com/max/1024/1*m1yQOgQIGJXJ4YpLywsoAw.jpeg)

Lastly, fill in the case description as the following and submit your request:

```

```

After the request is received, an initial response will be provided within 24 hours.

Once the process of obtaining your sender ID is completed, you will be notified. When you receive this notification, complete the steps in this section to configure Amazon Pinpoint to use your sender ID.

-   Sign in to the AWS Management Console and open the [Amazon Pinpoint console](https://console.aws.amazon.com/pinpoint/).
-   On the **All projects** page, choose a project that uses the SMS channel.
-   In the navigation pane, under **Settings**, choose **SMS and voice**.
-   Next to **SMS settings**, choose **Edit**.
-   Under **Account-level settings**, for **Default sender ID**, type your sender ID.
-   Choose **Save changes**.

### Registering phone numbers for sandbox destination

If your account is in the Sandbox mode, you will be expected to add a phone number and verify it. Go to the **Sandbox destination phone number** section and click on the **Add phone number** button.

![](https://cdn-images-1.medium.com/max/1024/1*bTOplQ1HY9EeyiY-CzFvIw.jpeg)

After that, add a new phone number and verify the number with a message.

![](https://cdn-images-1.medium.com/max/1024/1*Espf3o3_mbCD8aZsYY-7dg.jpeg)

After you verify your number and verification status as verified. Now you can send messages from your application. Run your application again and try to create an account. You will now receive a verification code that you can use.

![](https://cdn-images-1.medium.com/max/1024/1*gDIlefHZDENw1mF8XrNoug.jpeg)

Add it to your confirmation dialog to confirm the user:

![](https://cdn-images-1.medium.com/max/750/1*YXNAirnWzunp0wYV9MpRYw.jpeg)

Now you should be all set with phone verification!

Next step is wiring up the sign in flow with phone number.

For more information about the AWS Amplify authentication libraries you can check the [official documentation](https://docs.amplify.aws/lib/auth/getting-started/q/platform/flutter/), ask your questions at [Amplify Discord](https://t.co/KE3BsVI4eb). You can also check the source code for this over [GitHub](https://github.com/salihgueler/amplify_sms_test) and if you have any questions regarding to the Amplify and Flutter topics, send it to me via DM on [Twitter](https://twitter.com/salihgueler)!

See you in the next post!

[View embedded media](https://media.giphy.com/media/RgtBvgPxKzO0Aeo4vq/giphy.gif)
