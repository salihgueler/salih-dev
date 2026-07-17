---
title: "Deploy a Flutter Web Application Using AWS Amplify"
description: "Deploy a Flutter web application from a Git repository with AWS Amplify Hosting and a custom Flutter build configuration."
pubDate: "2024-07-30T14:54:29.000Z"
updatedDate: "2024-07-30T14:54:29.472Z"
category: "Flutter"
tags: ["flutter","aws-amplify","aws","hosting","flutter-web"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*0LIlRpVZwPTMH3EkAwBI8g.png"
  alt: "Deploy a Flutter Web Application Using AWS Amplify banner"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/deploy-a-flutter-web-application-using-aws-amplify-68a3e4399716"
aiSummary: "Deploy a Flutter web application from a Git repository with AWS Amplify Hosting and a custom Flutter build configuration."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/deploy-a-flutter-web-application-using-aws-amplify-68a3e4399716"}]
draft: false
---

Flutter is a UI toolkit used to create cross-platform applications for mobile, desktop, and web from a single codebase. Since developers can deploy their Flutter applications on the web without extra effort, they are seeking deployment options. With the release of AWS Amplify Gen 2, many new features have been announced for AWS Amplify. One notable feature is the simplified integration with Git workflows for both backend and hosting solutions, enabled by Amplify Console’s new user interface.

In this blog post, you will learn how to host a Flutter web application using Amplify Hosting, with the project code stored on GitHub. This tutorial is compatible with any supported Git provider, so you can also use BitBucket, GitLab, and CodeCommit.

**Requirements:**

-   An AWS account
-   Flutter SDK installed on your device
-   An account on any supported Git provider, this blog post will be using GitHub

## Creating a Flutter Project

Start by creating a Flutter project with web support by running the following command:

```

```

This will create a Flutter project with only web support enabled. The next step is to move our code to GitHub. You can do this using any Git tool you prefer. In this example, you will learn how to share it using VSCode.

First, open the project in VSCode and open the Command Palette by pressing Shift + Command + P (Mac) or Ctrl + Shift + P (Windows/Linux). Next, select the “Share on GitHub” option:

![VSCode UI with Command Palette open and “Publish to GitHub” option is highlighted](https://cdn-images-1.medium.com/max/1024/0*w-WS1jaZccKLKfm3.png)

Next, choose either a private or public repository based on your preference. Give your repository a name, and then the app will be shared on GitHub.

![VSCode UI to select GitHub repository type](https://cdn-images-1.medium.com/max/1024/0*ZlFaGwbLPyLErf4G.png)

Once the upload is done, the project can be seen on GitHub.

![GitHub project structure for the created Flutter project](https://cdn-images-1.medium.com/max/1024/0*tWta4_RfF4_qie1-.png)

Afterwards, go to the AWS Amplify in the [AWS console](https://console.aws.amazon.com/amplify/) and “Create new app” button.

![AWS Amplify Console with a “Create New App” button and “See how it works” button. At the bottom of the page the list of supported platforms indicated](https://cdn-images-1.medium.com/max/1024/0*eCx6qsZu40JG936t.png)

Select GitHub (or your Git provider) as your Git provider.

![AWS Amplify project creation screen with GitHub, BitBucket, CodeCommit and GitLab as Git provider options and an option to deploy without Git](https://cdn-images-1.medium.com/max/1024/0*IruqzRxv9yjVuL7R.png)

Once you select the Git provider and continue, you will be prompted to grant AWS Amplify permission to access your repositories.

![GitHub sign in for AWS Amplify to have access](https://cdn-images-1.medium.com/max/953/0*7-fmUWJ6j_k3Lw2b.png)

After granting access to AWS Amplify, you can now select the project and branch you want to deploy.

![List of projects from the Git Provider for users to select](https://cdn-images-1.medium.com/max/1024/0*GFnrjx3LNdn9YhR2.png)

Once you select your project and branch, the App Settings will be displayed. Update the “Frontend build command” to flutter build web and set the “Build output directory” to /build/web. After making these changes, click "Next" and proceed with the review step. Your initial deployment will then begin.

![App settings with app name, frontend build command and build directory](https://cdn-images-1.medium.com/max/1024/0*1EKhfFx82pn2mZAm.png)

You will see that your initial build will fail because the Flutter toolchain is not installed on your build system.

![main branch deployment fail status is shown on the project page](https://cdn-images-1.medium.com/max/1024/0*VHyywmi_gR_INHyu.png)

To fix this, you will need to update your build configuration file. Go to Hosting/Build settings in the left hand side navigation bar and locate the amplify.yml file.

![amplify.yml file with the set of steps to install flutter and build it](https://cdn-images-1.medium.com/max/1024/0*4rIGGVmYhUfad_O5.png)

Update the amplify.yml file with the following. This approach uses WASM (WebAssembly) for Flutter Web to host the app and bring out better and faster performance:

```

```

Now, go back to the deployments under your branch and click on the “Redeploy this version” button:

![Deployment page with deployment history with latest deploy’s build and deployment time](https://cdn-images-1.medium.com/max/1024/0*zMtcmw4kJ6w8wloB.png)

After the deployment, a domain will be automatically assigned to your build. Click on the assigned domain to check your deployment.

![Basic Flutter Web application with a counter on the center](https://cdn-images-1.medium.com/max/1024/0*Dgdqa5Pa-L2577fF.png)

Now let’s see how the update through CI/CD mechanism works. Update the code to change the title of the page, the color scheme, and the title of the app, as shown below:

![VSCode page with code changes described above](https://cdn-images-1.medium.com/max/1024/0*VAzV4lsdIcVISqWb.png)

You can see that with every push to Git, the deployment will be triggered automatically:

![New deployment with the auto update](https://cdn-images-1.medium.com/max/1024/0*fWTdUpM8OCN4gZxG.png)

With these changes, if you run the application again, you will see the updated UI.

![Same counter app with updated title and color scheme](https://cdn-images-1.medium.com/max/1024/0*KplBusSZ5te_swTE.png)

## Conclusion

In this blog post, you have learned about how to host a Flutter Web project with Amplify Hosting. You can check out the [Amplify Gen 2 docs](https://docs.amplify.aws/) to learn more about AWS Amplify Gen 2 and the [Amplify Hosting page](https://aws.amazon.com/amplify/hosting/) to learn about Amplify Hosting.
