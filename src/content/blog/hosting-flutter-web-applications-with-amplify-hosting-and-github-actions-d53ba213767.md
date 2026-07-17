---
title: "Hosting Flutter Web Applications with Amplify Hosting and GitHub Actions"
description: "Deploy Flutter web applications to AWS Amplify Hosting through an automated GitHub Actions workflow."
pubDate: "2022-07-20T17:03:11.000Z"
updatedDate: "2022-08-01T01:18:42.505Z"
category: "Flutter"
tags: ["flutter-web","flutter-app-development","flutter","flutter-web-deployment","aws"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*U_HShmTwoBpekU30HwrnuA.png"
  alt: "Cover image for Hosting Flutter Web Applications with Amplify Hosting and GitHub Actions"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/hosting-flutter-web-applications-with-amplify-hosting-and-github-actions-d53ba213767"
aiSummary: "Deploy Flutter web applications to AWS Amplify Hosting through an automated GitHub Actions workflow."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/hosting-flutter-web-applications-with-amplify-hosting-and-github-actions-d53ba213767"}]
draft: false
---

Flutter’s vision is to be the portable UI framework for building beautiful applications for all platforms (source: [Flutter Medium](https://medium.com/flutter/flutter-web-support-hits-the-stable-milestone-d6b84e83b425)). With the announcement of Flutter 2.0 at March 2021, Flutter’s Web support hit the stable release.

In this article, you will learn about hosting your Flutter Web applications over Amplify Hosting by automating your deployments with GitHub Actions and Amplify Hosting’s git based workflow settings.

**Requirements:**

-   An AWS Account (You can check this [guide](https://medium.com/p/ef748798fdbf) for creating an AWS Account, if you do not have an account)
-   A Flutter project with Web support hosted on GitHub (the repository can be public or private)

## Example Application

The app that you are going to be seeing is an application called Kahveinn. The application shows trivial coffee related information. You can find information about coffee beans, coffee makers and making coffees.

Here is a GIF to walk you through the application:

![Walk through of the website kahveinn.com](https://cdn-images-1.medium.com/max/800/1*tJbLpt74wCBkVhuS2qELUA.gif)

You can also reach out to the application over [GitHub](https://github.com/salihgueler/kahveinn_web).

Let’s start by deploying your project from GitHub.

## Setting up GitHub Actions

GitHub Actions is the CI/CD tool that GitHub created for building, testing and deploying your code directly from GitHub. You can hook your integrations to your workflows.

In your GitHub repository, go to the **Actions** tab and click on the **Set up a workflow yourself** option

![GitHub Actions tab of a new project over GitHub](https://cdn-images-1.medium.com/max/1024/1*MqV7mIN5fHlOC2RMk6iVyw.png)

This will open a text editor for you to create your first workflow. Remove everything from the editor.

![Empty editor for GitHub workflows.](https://cdn-images-1.medium.com/max/1024/1*H29pgwUnGCfuBA4IA0hNrA.png)

After you removed everything from it, paste the following code inside the editor:

The code in the gist above does the following:

-   (1): Triggers the workflow only when someone pushes a change on **main** branch.
-   (2): Checks out project, sets up Flutter as an environment and builds a release for Web
-   (3): Copies the Flutter Web release build files that is created earlier into an *artifacts* folder in the project
-   (4): Commits the copied files by using [Git Auto Commit](https://github.com/marketplace/actions/git-auto-commit) action

Now you can commit these changes to your project.

![A page to show a button for committing changes from GitHub](https://cdn-images-1.medium.com/max/1024/1*SbaHrepevWkxZ-Y1qBHdHg.png)

After you commit, your first action will run, and **it will fail, and it is okay.** You are missing a script to create *artifacts*folder and copy the release build in it.

At your base project folder, create a file called createandcopytofolder.sh and paste the code below into it.

This script will:

-   Check if *artifacts* folder exists and if it does removes it,
-   Creates an *artifacts* folder
-   Copy the release build elements in it.

After you commit that script and run your application, your action should be successful and you should see artifacts folder with *web* build inside it.

![](https://cdn-images-1.medium.com/max/1024/1*CuyMssYhN45K1l2mskQGVg.png)

## Setting up Amplify Hosting

AWS Amplify Hosting is a fully managed CI/CD and hosting service for fast, secure, and reliable static and server-side rendered apps that scale with your business. Supports modern web frameworks such as React, Angular, Vue, Next.js, Gatsby, Hugo, Jekyll, and more.

Since Flutter Web’s release build outputs are actual web components, Amplify Hosting will automatically support deploying that as well.

Let’s start by connecting the earlier created artifact to the Amplify Hosting.

First go to the [Amplify Hosting](https://aws.amazon.com/amplify/hosting/) and click on the **Host your web app** button on the website:

![Amplify Hosting website main page.](https://cdn-images-1.medium.com/max/1024/1*VcUpft610rYeS88Twd-3OA.png)

This will take you to a page to pick either a git provider or deploy it without one. For this example, you will pick GitHub but you can pick any of the options from below:

> *It will ask you to login with your AWS account, be sure to have an account before you move forward*

![Git providers over AWS console for Amplify Hosting.](https://cdn-images-1.medium.com/max/1024/1*2pzmM_87srj8bIzF-l7u3w.png)

After GitHub is picked, the browser will take you to install AWS Amplify to your organization, profile, or only to a repository.

![Three steps to install AWS Amplify for the GitHub account](https://cdn-images-1.medium.com/max/1024/1*A7h4uppMUgwhIs39T8Zvpw.png)

On GitHub you will be:

-   Selecting the profile or organization you would like to setup the Amplify
-   You can define the repositories that you would like to add Amplify to
-   You can also see the permissions that have been given to the Amplify

Once you set up the application. You will be directed back to the Amplify Hosting page again and you will be able to see the project/s that you allowed.

![Successful GitHub authentication page over AWS Console](https://cdn-images-1.medium.com/max/1024/1*9Y-KaYCQ3xJO6RBBTcG6nQ.png)

You can pick any project and any branch from the selected project the set up your project. For your Flutter Web step, one important point is clicking on the **Connecting a monorepo? Pick a folder** checkbox and add *artifacts/web* path to the field that is shown and click on next:

![Page indicating the process of defining the artifact path over AWS Console](https://cdn-images-1.medium.com/max/1024/1*dKknWRnxRefxgyD-Tvb5Cw.png)

In the next page, according to your project type and information you have entered before, Amplify Hosting will generate a build file. You do not need to touch that, you can go to the next page.

![Script for deploying web applications (can be skipped)](https://cdn-images-1.medium.com/max/1024/1*9ad3NX17I-IqshKnxOEPOQ.png)

On the next page, you can check your build settings and click on the **Save and Deploy** button if everything is as expected.

![AWS Console page to show save and deploy button](https://cdn-images-1.medium.com/max/1024/1*sCixWK4-3Cxq90KwV085gQ.png)

Once your application is saved, it will start the deployment process. Just wait for a couple of minutes until all the deploy steps are green:

Once everything is green, click on the URL that is indicated with the arrow above and you should see the first deployment of your Flutter Web application!

![](https://cdn-images-1.medium.com/max/1024/1*_Wc9Hi_c9sjmoH9e7KeBCQ.png)

## BONUS! Adding Custom Domain to your Website

Most of the time, folks have a tendency to use generated URLs for their Flutter Web applications. But, if you want, you can also setup your domain name.

Click on the **Domain management** on the left pane and click on the **Add domain** button on the domain management page.

![Domain management page over AWS Console with Add Domain button indicator](https://cdn-images-1.medium.com/max/1024/1*A28-M5AA_6F20DSWvWIZgg.png)

After that, you will be directed to a page to enter your domain address and click on the **Save** button by leaving all as it is.

![AWS Console page to add custom domain with an indicator over Save button](https://cdn-images-1.medium.com/max/1024/1*p4AFT1CPViHRlZeiAHMKdw.png)

This will initiate the process for creating an SSL certificate and domain activation.

![Overview of SSL Configuration page over AWS Console](https://cdn-images-1.medium.com/max/1024/1*jslCXCyqwsJe-jImLMFMaQ.png)

For domain activation and SSL configuration, check [this link](https://docs.aws.amazon.com/amplify/latest/userguide/to-add-a-custom-domain-managed-by-google-domains.html) for how you can activate custom domain for provider. You can find guides for Google Domains, GoDaddy etc.

![Domain management page overview with a custom domain](https://cdn-images-1.medium.com/max/1024/1*WHKGuaCkzJXgIfxq__BTRQ.png)

Once you add the domain successfully, you can see under **Domain management** that the custom domain is active and available.

## Wrapping up

Flutter for Web and its support created a demand from the community for hosting options and now you know how you can host your Flutter Web applications over Amplify Hosting with GitHub actions. You can try these steps out with your next Flutter Web project!

For more information about the AWS Amplify libraries you can check the [official documentation](https://docs.amplify.aws/start/q/integration/flutter/?sc_icampaign=flutter-start&sc_ichannel=docs-home), if you have any questions regarding to the Amplify and Flutter topics you can either ask it at [Amplify Discord](https://t.co/KE3BsVI4eb) or send it to me via DM on [Twitter](https://twitter.com/salihgueler)!
