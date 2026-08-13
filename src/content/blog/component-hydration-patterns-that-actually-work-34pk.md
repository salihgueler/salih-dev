---
title: "Component hydration patterns that actually work with Jaspr"
description: "Compare hydration strategies and show how Jaspr synchronizes server-rendered component state with the client without manual serialization."
pubDate: "2026-03-25T21:26:54Z"
updatedDate: "2026-03-26T10:20:08Z"
category: "Web Development"
tags: ["dart","jaspr","webdev","ai"]
hero:
  src: "https://salih.dev/images/blog/3405099-component-hydration-patterns-that-actually-work-34pk.webp"
  alt: "Cover image for Component hydration patterns that actually work with Jaspr"
  credit: "DEV Community"
  creditUrl: "https://dev.to/salihgueler/component-hydration-patterns-that-actually-work-34pk"
aiSummary: "Compare hydration strategies and show how Jaspr synchronizes server-rendered component state with the client without manual serialization."
originalUrl: "https://dev.to/salihgueler/component-hydration-patterns-that-actually-work-34pk"
sources: [{"name":"DEV Community","url":"https://dev.to/salihgueler/component-hydration-patterns-that-actually-work-34pk"}]
draft: false
---

Every framework with server-side rendering faces the same problem. You render HTML on the server, send it to the browser, then your JavaScript needs to take over without breaking what's already there. This is hydration, and most frameworks make you think about it constantly.

React introduced SSR years ago. In the older "Pages Router" model, you had to serialize state manually and often fought hydration mismatches. Modern Next.js (App Router) improved this with React Server Components, which stream data to the client automatically. However, you are still managing the "boundary" between server and client explicitly. You mark components with `"use server"` or `"use client"` and carefully manage which code runs where. Vue and Svelte have similar patterns. Every component that needs server data requires explicit data fetching and passing.

The core issue is that frameworks treat server rendering and client rendering as separate concerns. You render on the server, somehow get the data to the client, then render again. If these two renders produce different output, hydration breaks. If you forget to pass some state, components remount with empty data and flicker.

[Jaspr](https://jaspr.site/) takes a different approach. Components are universal by default. State syncs automatically. The same component code runs on server and client, and the framework handles transferring state between them without manual serialization.

This isn't specific to Jaspr. The pattern applies to any SSR framework. Some implement it better than others. Understanding how automatic hydration works makes you better at building SSR apps in any framework.

## Why manual hydration is error-prone

Here's what most SSR frameworks make you do. First, fetch data on the server:

```typescript
// Next.js example
export async function getServerSideProps() {
  const data = await fetchSomeData();
  return { props: { data } };
}

export default function Page({ data }) {
  return <div>{data.title}</div>;
}
```

This works, but you're managing data flow manually. The server fetches data, passes it as props, and the component renders. When this reaches the client, Next.js serializes `data` as JSON in the HTML, then deserializes it during hydration.

The problem shows up when you have nested components with their own data needs:

```typescript
export default function Page({ data }) {
  return (
    <div>
      <Header data={data.header} />
      <Content data={data.content} />
      <Sidebar data={data.sidebar} />
    </div>
  );
}
```

You're threading props through every level. If Sidebar has a child component that needs data, you pass it down again. This is prop drilling, and it's a code smell.

You could use Context to avoid prop drilling, but that doesn't solve the real problem. You still fetched all the data at the top level and distributed it manually. If one component needs different data based on user interaction, you fetch it client-side and now you have two data fetching patterns in the same app.

Some frameworks let components fetch their own data. React Server Components do this. Each component can be async and fetch what it needs. The server waits for all async components, renders the tree, and sends it to the client.

This is better, but you still manage the boundary between server and client explicitly. You mark components with "use server" or "use client" and think about which code runs where. This is necessary complexity for React's architecture, but it's still complexity you're managing.

## Automatic state sync reduces cognitive load

The better pattern is making state sync automatic. Components should be able to have state, and that state should transfer from server to client without you writing transfer code.

In modern Jaspr, the build method returns a single Component, aligning with Flutter’s syntax and enabling better performance optimizations in the Dart-to-JS compiler. Here's how it works in Jaspr:

```dart
class CounterComponent extends StatefulComponent {
  @override
  State createState() => _CounterState();
}

class _CounterState extends State<CounterComponent> {
  int _count = 0;

  void _increment() {
    setState(() {
      _count++;
    });
  }

  @override
  Component build(BuildContext context) {
    return button(
      events: {'click': (_) => _increment()},
      [.text('Count: $_count')],
    );
  }
}
```

When this renders on the server, _count is 0. Jaspr serializes that state and embeds it in the HTML. When the client hydrates, it reads that data and initializes the component with _count = 0. The button works immediately because the state is already there.

For complex data, Jaspr provides the @sync annotation. It automatically generates the logic needed to move data from the server to the client.

```dart
// article_page.dart
import 'article_page.sync.dart';

class ArticlePage extends StatefulComponent {
  final String id;
  const ArticlePage({required this.id});

  @override
  State createState() => _ArticlePageState();
}

class _ArticlePageState extends State<ArticlePage> with _ArticlePageStateSyncMixin, PreloadStateMixin {
  @sync
  Article? _article;
  
  @sync
  List<Comment> _comments =;

  @override
  Future<void> preloadState() async {
    // Only runs on the server to fetch data before the first render
    _article = await api.fetchArticle(widget.id);
    _comments = await api.fetchComments(widget.id);
  }

  @override
  Component build(BuildContext context) {
    if (_article == null) {
      return div([.text('Loading...')]);
    }
    
    return div([
      ArticleHeader(article: _article!),
      ArticleContent(article: _article!),
      CommentList(comments: _comments),
    ]);
  }
}
```

The PreloadStateMixin handles the server-side acquisition of data, delaying the render until the futures complete. The @sync annotation then ensures that once the client takes over, it already has the values for _article and _comments in its local state, preventing a "flash of loading" or redundant API calls.

## Handling non-serializable state

Some state can't serialize: WebSocket connections, file handles, or DOM references. These exist only on the client.

```dart
class _RealtimeComponentState extends State<RealtimeComponent> {
  WebSocketChannel? _channel;
  List<Message> _messages =;

  @override
  void initState() {
    super.initState();
    // Only connect WebSocket on client
    if (kIsWeb) {
      _connectWebSocket();
    }
  }

  @override
  Component build(BuildContext context) {
    return div();
  }
}
```

The pattern handles this by checking kIsWeb. The server renders the initial UI, and the client establishes the live connection upon hydration.

## Optimized tree reconciliation

Jaspr follows the Flutter model. It uses a component tree that produces a render tree. When you call setState, the framework reconciles the changes and applies surgical updates to the DOM. Because the build methods now return a single component, Jaspr can more efficiently track these dependencies and update only specific nodes without expensive full-page re-renders.

## When to use SSR vs SSG vs CSR

While automatic hydration is powerful, you must choose the right rendering mode for your project. In Jaspr, this is a structural configuration defined in your pubspec.yaml or during the jaspr create step.

Unlike some frameworks, there is no --mode flag for the jaspr build command; the CLI reads your project's configuration to decide how to build your assets. 

```bash
jaspr:
  mode: static # Can be 'static', 'server', or 'client'
```

- Static (SSG): Pre-renders pages at build time. Ideal for blogs and documentation. Run jaspr build to generate static HTML.

- Server (SSR): Renders components dynamically for every request. Essential for personalized or frequently changing content.

- Client (CSR): Skips the server. Useful for behind-the-login dashboards where SEO isn't a priority.

## Testing hydration without deploying

Jaspr includes a test package that simulates the full lifecycle in a single process, without needing a real browser.

```dart
import 'package:jaspr_test/jaspr_test.dart';

void main() {
  testComponents('Counter hydrates correctly', (tester) async {
    // 1. Setup component
    await tester.pumpComponent(CounterComponent());
    expect(find.text('Count: 0'), findsOneComponent);
    
    // 2. Simulate hydration transition
    await tester.hydrate();
    
    // 3. Interact with client-side logic
    await tester.click(find.tag('button'));
    expect(find.text('Count: 1'), findsOneComponent);
  });
}
```

This runs in a single test process. No actual server or browser needed. You can test the full lifecycle: server render, hydration, interaction, state updates.

For complex components with async data loading:

```dart
testComponents('Article page hydrates with data', (tester) async {
  final mockApi = MockArticleApi();
  when(mockApi.fetchArticle(any)).thenAnswer((_) async => testArticle);
  
  await tester.pumpComponent(
    ArticlePage(id: '123', api: mockApi),
  );
  
  // Wait for async data loading
  await tester.pump();
  
  expect(find.text(testArticle.title), findsOneComponent);
  
  // Hydration should preserve the loaded data
  await tester.hydrate();
  
  expect(find.text(testArticle.title), findsOneComponent);
  verify(mockApi.fetchArticle('123')).called(1);
});
```

## Performance characteristics of different hydration strategies

Hydration has a cost. The server renders HTML, the client downloads JavaScript, parses it, and then "boots up" components. For large pages, this can take time.

Here's how different strategies compare:

| Strategy | Initial Render | Time to Interactive | Server Load | Best For |
|----------|---------------|-------------------|-------------|----------|
| Full SSR + hydration | Fast (HTML from server) | Medium (load & hydrate JS) | High (render per request) | Dynamic content, SEO-critical |
| SSG + hydration | Fastest (pre-rendered HTML) | Medium (load & hydrate JS) | None (built once) | Static content, blogs |
| CSR only | Slow (wait for JS) | Medium (render in browser) | None (static files) | Authenticated apps |
| Partial hydration | Fast (HTML from server) | Fast (hydrate only interactive parts) | Medium | Mostly static with interactive widgets |
| Islands architecture | Fast (HTML from server) | Fastest (minimal JS) | Medium | Content sites with isolated interactivity |

Automatic state sync traditionally fits the "Full SSR + hydration" strategy. However, Jaspr now has first-class support for the Islands Architecture via the @island annotation and dedicated templates. 

In an Islands approach, you render the page as static HTML and only hydrate specific, annotated components. This allows you to ship significantly less JavaScript to the client. You can use the jaspr create -t islands command to set up a project designed for this architecture from the start. 

## What this pattern enables

Automatic state sync changes how you think about building SSR apps. Instead of managing data flow between server and client, you write components with state and let the framework handle transfer.

The core insight is the same across frameworks: when the framework knows about your state, it can transfer it for you. The less you manage serialization and data flow manually, the fewer bugs you introduce.

For Dart developers, Jaspr makes this feel natural because the component model matches Flutter. If you've built Flutter apps, you already know how to manage state with setState. Making that work on the server and client is the framework's job, not yours.

The tradeoff is giving up control over exactly how and when state transfers. If you need custom serialization logic or want to optimize what data transfers, you're fighting the framework. For most apps, automatic is better. For apps with unique performance constraints, manual control might be necessary.

## Resources

- [Jaspr documentation](https://docs.jaspr.site)
- [Understanding hydration (Addy Osmani)](https://addyosmani.com/blog/rehydration/)
- [Islands architecture (Jason Miller)](https://jasonformat.com/islands-architecture/)
- [React Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)

Connect with me on social media:
- Twitter: [@salihgueler](https://twitter.com/salihgueler)
- LinkedIn: [@salihgueler](https://linkedin.com/in/salihgueler)
- GitHub: [@salihgueler](https://github.com/salihgueler)
- Bluesky: [@salihgueler](https://bsky.app/profile/salihgueler)
