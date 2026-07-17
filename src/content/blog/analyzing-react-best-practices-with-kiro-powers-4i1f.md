---
title: "Analyzing React Best Practices with Kiro Powers"
description: "Package React and Next.js best practices as a Kiro Power, then use it to audit AI-generated frontend code."
pubDate: "2026-01-21T08:59:21Z"
category: "AI Development"
tags: ["kiro","agents","ai","webdev"]
hero:
  src: "https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2F0o8xlk9ickdpioyu7but.png"
  alt: "Cover image for Analyzing React Best Practices with Kiro Powers"
  credit: "DEV Community"
  creditUrl: "https://dev.to/kirodotdev/analyzing-react-best-practices-with-kiro-powers-4i1f"
aiSummary: "Package React and Next.js best practices as a Kiro Power, then use it to audit AI-generated frontend code."
originalUrl: "https://dev.to/kirodotdev/analyzing-react-best-practices-with-kiro-powers-4i1f"
draft: false
---

Developers pair-program with AI assistants to build software outside your expert areas. One big example I have observed is, backend and cloud engineers building frontends. However, they all have the same concern: how do you verify the frontend code quality and be sure you follow the best practices? 

On last Wednesday (Jan 14th), Vercel [announced](https://vercel.com/blog/introducing-react-best-practices) the set of AI skills to follow the best practices for React and Next.js applications, addressing this exact need. Therefore, I decided to bring these best practices to Kiro as well by building a Kiro Power. 

Before we move forward, a disclaimer: This is not an official version, it is just me using Kiro to build a Kiro power :) 

## Power Builder

We have been talking about Kiro Powers but what are they? Kiro Powers inject specialized context and tools into Kiro agents on-demand, providing focused knowledge exactly when needed. Unlike traditional context injection that loads everything upfront, Powers activate specific capabilities dynamically. 

You might be wondering, why not just use MCP? Even though MCP is a great solution for many problems, it comes with trade-offs. To find an answer or a content, it still needs to go through information and it has an impact on the context window. However with powers, you can focus and bring only what you need and save some context window.

To build Kiro Powers you can use the [Power Builder](https://github.com/kirodotdev/powers/tree/main/power-builder). You can add it with a single click to your project.

![Kiro IDE screenshot with a highlight of showcasing Power Builder installed.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/dmscuy6td7j54iep3wzl.jpg)

Once you add that, now Kiro has the resources and context to build new Kiro Powers. 

## Prompt that bringing all together

Writing a proper prompt is one of the most fun but also challenging parts of building with AI nowadays. We have to have crisp, well written instructions on what we want to build and how we want to build. We can't say "build me a sign up" page and expect AI to build everything without missing a point with the design that we are imagining. 

There are great resources such as [this FAQ section](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-the-openai-api) from Open AI on how to write prompts but I highly recommend the the [great article](https://dev.to/aws/how-i-used-kiro-to-optimize-its-own-mcp-configuration-4mdg) that my colleague Danilo Poccia wrote on how you can optimize your AI assistant to optimize itself and it helped me a lot to optimize my prompt as well. 

Each step in this prompt serves a purpose: Step 1 ensures complete feature coverage, Step 2 guarantees proper Power structure, Step 3 defines clear specifications, and Step 4 creates a review checkpoint before execution. This structure helps you adapt the prompt for your own Power creation.

```markdown
1. I want to create a Kiro Power from the Vercel agent-skills repository. Clone https://github.com/vercel-labs/agent-skills and analyze all files including subfolders to understand the complete feature set.

2. Research the official Kiro Powers documentation online to understand the correct folder structure, POWER.md frontmatter syntax (name, displayName, description, keywords, mcpServers), and steering file best practices.

3. Create a Power called "react-best-practices" with:
a. Publisher: "Salih Güler"
b. All agent skills converted to steering files (exclude Vercel deployment content)
c. Proper keywords that match how developers naturally talk about React/Next.js optimization
d. A README explaining how to install and use the Power

4. Prepare a detailed plan first and propose it to me before creating any files. Show me:
a. Which agent skill files you found and what they cover
b. How you'll organize them into steering files
c. The proposed keywords for activation
d. The POWER.md frontmatter you'll use
```

Once I ran the prompt, Kiro activated the "Power Builder", went through the files, came up with a plan to map **rules** to **steering files** and created a plan to create a **POWER.md** file and asked me if I want to execute it. After I said yes, all was done in a few seconds:

![Kiro created the Kiro Power for React Best Practices.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/4n3j65p9o9r28o5ap24j.jpg)

## Using Kiro Powers

You can use Kiro Powers in three different ways. You can use the official ones with a click and install. You can use them from GitHub repositories and from your local folders. 


![Import window for importing Kiro Powers. Options are GitHub repository or local file.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/g7djet422hyl05r1thp8.jpg)

You can use the GitHub repository [reference](https://github.com/salihgueler/react-best-practices) or the local folder to install the power.

![Showcasing the new Kiro Powers successfully installed for React Best Practices.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3y24xbyyhfopcdw3hf2c.jpg)

## Running the React Best Practices on an Actual Project

I built a [project](https://github.com/salihgueler/library-recommendation-system) to teach some students about how to build a full-stack application with AWS. 

When I built it, I was more prototyping and building to create a starting point for my students. With this I will check how much improvement that we can make on the project. 

![React best practices power is starting to go through the project.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/ssaoqlb8fkdah86r0ju6.jpg)

Once you run the project, it analyzes your codebase and identifies improvements. In my case, it found:

- Missing error boundaries in React components
- Unoptimized image loading without Next.js Image component
- Client-side data fetching that could move to server components

Here's the full analysis:

![Kiro Power Analysis for React Best Practices](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/3284qcs4sl94tmss4f14.png)

After you are good with all, you can tell it to implement everything for your project. Once it is done, you can check the project on how many files changed and what changes happened. 

You can also define a global steering file rule to commit the changes by splitting them logically. 

![All of the suggestions implemented and split in to logical commits. User is given this feedback by the IDE.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/vg3ehy9nae3fzeld1lk3.jpg)

## Conclusion

AI transforms how we build software daily. Kiro Powers offer a focused approach to code quality—activating expert knowledge when you need it without overwhelming your context window.

What you learned:

- How to convert existing agent skills into Kiro Powers
- The difference between Powers and MCP servers
- A practical workflow for code quality checks

Considerations:

- Powers work best with well-defined rule sets
- Initial setup requires understanding Power structure
- Results depend on your project's complexity

This Power is part of [promptz.dev](https://www.promptz.dev/powers/promptz-power-react-best-practices) (a website that you can find great prompts and context files to enhance your development workflow) for broader availability (and you can check the source code and create issues on the on the [promptz.dev repository](https://github.com/cremich/promptz.lib). Try it on your React projects and share feedback—your input helps improve the Power for everyone.
