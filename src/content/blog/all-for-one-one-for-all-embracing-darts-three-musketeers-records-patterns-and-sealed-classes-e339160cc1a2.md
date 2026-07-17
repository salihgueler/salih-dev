---
title: "All for One, One for All: Embracing Dart’s Three Musketeers — Records, Patterns, and Sealed Classes"
description: "Explore how Dart records, pattern matching, and sealed classes work together to model data and control flow more expressively."
pubDate: "2023-05-12T10:10:13.000Z"
updatedDate: "2023-05-15T16:24:07.023Z"
category: "Dart"
tags: ["record","sealed","flutter","3-d-art","patterns"]
hero:
  src: "https://cdn-images-1.medium.com/max/1024/1*5dyYamxnNan1Mhl7h86VLQ.png"
  alt: "Cover image for All for One, One for All: Embracing Dart’s Three Musketeers — Records, Patterns, and Sealed Classes"
  credit: "Medium"
  creditUrl: "https://medium.com/flutter-community/all-for-one-one-for-all-embracing-darts-three-musketeers-records-patterns-and-sealed-classes-e339160cc1a2"
aiSummary: "Explore how Dart records, pattern matching, and sealed classes work together to model data and control flow more expressively."
sources: [{"name":"Medium","url":"https://medium.com/flutter-community/all-for-one-one-for-all-embracing-darts-three-musketeers-records-patterns-and-sealed-classes-e339160cc1a2"}]
draft: false
---

## All for One, One for All: Embracing Dart’s Three Musketeers — Records, Patterns, and Sealed Classes

Get ready for a journey into the realm of programming as the highly anticipated release of Dart 3.0 is announced at Google IO 2023!

It came with new features that will revolutionize the way you code. Dart 3.0 introduces game-changing elements such as records, patterns, and sealed classes, paving the way for unparalleled flexibility and efficiency in your development process.

Dart 3’s game-changing features have ignited a fire of excitement is so contagious that [AWS Amplify](https://github.com/aws-amplify/amplify-flutter) has already jumped on board, eagerly leveraging these cutting-edge capabilities within our Flutter SDK. With the [1.1.0](https://github.com/aws-amplify/amplify-flutter/releases/tag/v1.1.0) release, users can also use these great features with the libraries as well.

You can check out the refactoring PRs over the [PR 1](https://github.com/aws-amplify/amplify-flutter/pull/2998), [PR 2](https://github.com/aws-amplify/amplify-flutter/pull/3012/files) and [PR 3](https://github.com/aws-amplify/amplify-flutter/pull/2995/files). (Kudos to our great teammate [Dillon Nys](https://twitter.com/dillonthedev)!).

So, prepare to be amazed as we delve into the exciting world of Dart 3.0, exploring its innovative features. Are you ready to embark on this exhilarating journey? Let’s dive in!

## Sealed Classes (with a hint of Pattern Matching)

Sealed classes are probably the most anticipated feature fore Dart language. The main issue, created in 2018 on GitHub, has finally been closed with a beautiful message.

![](https://cdn-images-1.medium.com/max/1007/1*ECR5n5nfOQpJar2kVCnKjA.png)

Sealed classes are important in object-oriented programming because they provide a way to control and restrict the inheritance hierarchy of a class. By marking a class as sealed, it cannot be inherited or implemented by any other class outside its own library.

The best example which showcases this is by controlling the states while using [bloc](https://pub.dev/packages/bloc) library and taking advantage of pattern matching with exhaustive switching (explanation on both will come later in detail).

Let’s see a possible refactoring with an actual example. With the [Amplify Grocery List](https://github.com/salihgueler/amplify_grocery_list) application that I created earlier on, let’s update one of the state files by using sealed classes.

You can see that, instead of the abstract class, now you can use the sealed class to define the base state type.

Let’s bring this information into the new exhaustive switch. The **build** function of the *\_InvoiceView* was long and had a lot of *if* statements. This could bring risks of missing a statement to be handled.

However, with the new switch statement, one can return the each necessary item, bind the fields with **or** (or any other) logical operator. You can see that, exhaustive switching helps us to handle all cases.

### More on Exhaustive Switch

Exhaustive switching helps us avoid becoming our own worst enemy by ensuring we don’t forget to check every state.

Let’s use an example from AWS Amplify. Before a person would fetch the current session like the following.

They would act on the result by diving deep to the documentation, checking each use case and type of information that a user has. However, exhaustive switching works not only with sealed classes, but also with enums. So if you want to be sure you are handling all the cases for your session, you can use the following way:

However, if you’re looking to leverage pattern destructuring (which will be explained more in detail later on) alongside exhaustive switching, you can start by using the latest version of AWS Amplify to get the support for these features.

The example above will transform into the following:

Looking cool, right? But that is not the only case that you can leverage exhaustive switching. You can also use it to do error handling:

With the example above, thanks to the updates of the AWS Amplify libraries, when you do a call such as asking to print user attributes, on a fail scenario you can handle each exception type and behave accordingly.

## Records

[View embedded media](https://media.giphy.com/media/l41Ym9sB9yaIsUWpa/giphy.gif)

Records are introduced to simplify the creation of simple data-holding objects and reduce boilerplate code. They are not intended to replace regular classes but rather provide a specialized construct for certain use cases.

Records’ are:

-   fixed-sized
-   heterogeneous
-   typed
-   anonymous
-   and immutable.

Since they are actual values, they can be assigned to variables, pass in as a reference to the functions or stored in collection types.

They also automatically define *hashcode* and *\==* methods based on the structure of their fields.

You can see that creation of the Records is like you would define function signatures.

You can reach to the properties by pointing to their positions. Or, you can also reach out to them by using their property names by defining them with curly braces *and* assigning them by their names.

## Patterns (or how we match and destruct them)

[View embedded media](https://media.giphy.com/media/LOoaJ2lbqmduxOaZpS/giphy.gif)

Pattern matching and destructuring are two powerful techniques in programming that allow you to extract and compare data.

Pattern matching involves comparing data structures against specific patterns, enabling conditional execution based on the match. Destructuring, on the other hand, provides a way to extract individual elements from complex data structures such as arrays or objects and assign them to variables.

Pattern matching’s biggest example is combining it with exhaustive switching to compare numbers (which we have seen before). Pattern destructuring on the other hand is a special case that can be leveraged on many scenarios to fetch the properties of complex objects.

You can either destruct the variables into new variables:

Or you can bind them to an object of same type like the following example:

## Conclusion

In conclusion, Dart’s introduction of records, patterns, and sealed classes has ushered in a new era of programming possibilities. The addition of records simplifies the creation of immutable data structures, promoting clarity and reducing boilerplate code. Patterns empower developers with powerful tools for efficient data manipulation and handling different cases or variants. Sealed classes ensure exhaustive pattern matching, enhancing code safety and maintainability. These features have already garnered widespread excitement within the developer community, and their adoption by SDKs like AWS Amplify showcases their potential. To dive deeper into Dart’s records, patterns, and sealed classes, check out the following resources:

-   [Dart documentation for Records](https://dart.dev/language/records)
-   [Dart documentation for Patterns](https://dart.dev/language/patterns)
-   [Dart documentation for sealed classes](https://dart.dev/language/class-modifiers#sealed)

You can find me on the social media over the following Linktree for questions!

[salihgueler | Twitter, Twitch | Linktree](https://linktr.ee/salihgueler)
