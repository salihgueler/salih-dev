---
title: "How I Built a Flame Engine MCP Server to Build Flutter Games"
description: "Build an MCP server for the Flutter Flame engine that gives coding assistants contextual documentation, examples, and game-development support."
pubDate: "2025-07-02T20:00:26Z"
updatedDate: "2025-07-03T10:32:33Z"
category: "Flutter"
tags: ["flutter","mcp","flameengine","gamedev"]
hero:
  src: "https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Fto7yf6pq7fmfv0iboc84.png"
  alt: "Cover image for How I Built a Flame Engine MCP Server to Build Flutter Games"
  credit: "DEV Community"
  creditUrl: "https://dev.to/salihgueler/how-i-built-a-flame-engine-mcp-server-to-build-flutter-games-3ea2"
aiSummary: "Build an MCP server for the Flutter Flame engine that gives coding assistants contextual documentation, examples, and game-development support."
originalUrl: "https://dev.to/salihgueler/how-i-built-a-flame-engine-mcp-server-to-build-flutter-games-3ea2"
draft: false
---

Building cross-platform games with Flutter and the [Flame engine](https://docs.flame-engine.org/latest/) offers exciting possibilities, but the learning curve can be steep. Developers often struggle with grasping new concepts, finding appropriate libraries, and efficiently navigating between development environments and documentation. In this blog post, we will show how to leverage Amazon Q Developer to improve your Flutter game development process, enabling you to focus on creativity rather than wrestling with technical hurdles.

In this blog post, we show how you can create a Model Context Protocol (MCP) server that integrated into any tool that supports MCP, e.g. Amazon Q Developer CLI. The server can be used to improve your Flutter game development workflow. By the end of this tutorial, you'll have a custom MCP server that:

1. Provides real-time, context-sensitive coding assistance for Flame engine development
2. Offers instant access to relevant documentation and best practices
3. Helps debug common issues specific to Flutter game development
4. Accelerates your learning of game development concepts within your familiar IDE

The approach outlined in this post can help developers to improve their game creation process. Whether you're building your first Flutter game or looking to optimize your existing development workflow, this integration of Amazon Q Developer CLI through an MCP server can significantly increase your productivity.

Let's dive into how you can set up this game development sidekick and start building Flutter games more efficiently.

##### Requirements
- Latest version of Flutter and Dart SDKs. Install them through [official docs](https://docs.flutter.dev/get-started/install).
- An active GitHub account with a personal access token.[Learn how to create a GitHub token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- Amazon Q Developer CLI installed and configured. [Install and set up Amazon Q Developer](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-installing.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el). You can use the Amazon Q Developer CLI through [BuilderID](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-installing.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el). 
- An IDE or text editor of your choice (we recommend Visual Studio Code with the Dart extension)

If you are interested  in the source code, you can:

- Check out the [Flame MCP Server](https://github.com/salihgueler/flame_mcp_server) project
- Check out the [source code](https://github.com/salihgueler/pong_breakout_game) of the Pong game

## Understanding MCP

The Model Context Protocol (MCP) standardizes how applications provide context to Large Language Models (LLMs). It serves as an intelligent intermediary between AI models and external tools or data sources for our AI workflows.

![Diagram comparing AI capabilities before and after MCP Server implementation](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/my30r0cpukx3ejxsjakn.png)

MCP provides the following three core capabilities:

- **Resources**: File-like data that clients can read, such as Flame engine documentation, tutorial content, and code examples from your game project
- **Tools**: Functions that LLMs can execute (with user approval), such as searching through documentation, analyzing game code, or providing relevant code snippets
- **Prompts**: Pre-written templates that help users accomplish specific tasks, like finding the right animation implementation or debugging game physics

For example, when working with Flutter and the Flame engine, MCP can help you quickly find relevant documentation about sprite animations while you're coding, suggest optimizations for your game loop implementation, or provide step-by-step guidance for implementing complex game mechanics - all without leaving your development environment.

Now that we understand what MCP is and how it can enhance game development, let's look at how to build an MCP server that integrates with Amazon Q Developer to create this seamless documentation and learning experience.

## Building the MCP Server for Flame Engine with AI Assistant

Building an MCP server for the Flame engine presented an exciting challenge that combined cutting-edge AI integration with game development. After discussions with Lukas, one of the Flame Engine maintainers, I decided to implement the MCP server in Dart to ensure consistency with the engine's ecosystem. This approach would provide seamless integration for Flame developers.

While the official MCP website offers tutorials and SDKs, creating a custom MCP server without these tools can be complex. To overcome this challenge, I used the power of AI-assisted development using Amazon Q Developer CLI. This tool significantly improved the development process by providing context-aware coding assistance and access to relevant documentation. In the following sections, we'll explore how Amazon Q Developer CLI helped me with the creation of our Dart-based MCP server, offering a blueprint for integrating AI assistance into your own game development workflow.

To kick off, open up the Q Developer CLI by writing `q` to the terminal:

![Q CLI Screen](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/433zeg5eyist7ge0x1mm.jpg)

Next, we'll walk through the process of using Amazon Q Developer CLI to create our Dart-based MCP server for the Flame engine. Follow these steps to implement your own server:

1. Copy the contents of the MCP server guide file into the CLI. This file contains essential information about MCP server requirements.
2. Describe your specific MCP server requirements. Here's an example prompt:

```text
With the provided context, I want to build a Model Context Protocol (MCP) server from scratch that provides AI assistants like Claude Desktop and Amazon Q Developer 
with comprehensive access to Flame game engine documentation and tutorials. The MCP server should be written in Dart and implement the MCP specification (JSON-RPC 
over stdio). It needs two main tools: 'search_documentation' for searching through cached Flame docs, and 'tutorial' for providing step-by-step game development 
tutorials (space shooter, platformer, klondike). The server should read from a local cache directory containing 146+ markdown files downloaded from the 
flame-engine/flame GitHub repository's doc folder. Include proper error handling, absolute path resolution for cross-platform compatibility, and clean 
separation between the MCP server (read-only operations) and a separate sync script that downloads documentation from GitHub API. The server should support 
both resource listing ( for Claude Desktop) and tool execution, with proper MCP protocol responses including initialize, tools/list, tools/call, and 
resources/list methods. Make it production-ready with proper logging, documentation, and a build script that compiles everything into a single executable 
that can be configured in MCP client settings.
```

Allow Amazon Q Developer CLI to generate the server code. Once complete, review the output carefully:

1. Examine the overall structure and package imports
2. Verify that all requested capabilities are implemented
3. Check for Dart-specific best practices and Flame engine compatibility

To test and validate, you can perform the following tests to ensure your MCP server functions correctly:

**Manual testing:**

1. Use different MCP clients to test server responses
2. Verify that documentation access works as expected
3. Test the search functionality with various queries

**Data and behavior verification:**

1. Cross-reference server responses with official Flame documentation
2. Check for any inconsistencies or unexpected behaviors

**Code quality assessment:**

1. Run Dart analyzer: `dart analyze`
2. Apply lint rules
3. Review generated code for readability and maintainability

With Amazon Q Developer CLI, we've demonstrated how to rapidly create an MCP server for the Flame engine. However, for those who prefer a more hands-on approach or want to deepen their understanding of MCP server architecture, the following sections will guide you through building the server manually. 

This step-by-step walkthrough will not only showcase what your project might look like when built from scratch but also provide valuable insights into the inner workings of an MCP server. By comparing the AI-assisted and manual approaches, you'll gain a comprehensive understanding of MCP server development for game engines like Flame.

## Building the MCP Server Manually

### Creating the Dart Projeect

First, create a Dart project:
```bash
dart create -t cli flame_mcp_server
```
This command will create a project with following structure:
 
![Project structure for the newly created Dart Project.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/mbqptoq5mp6qilz1iuin.jpg)

When building your MCP server in Dart, it's important to organize your code following Dart's conventional project structure. Here's how to set up your project directories:

**bin/**

- Contains executable applications
- Place your MCP server entry point here
- This code will be directly executable

**lib/**

- Houses your core business logic
- Contains internal MCP server implementation
- Includes service integrations and utilities

**lib/src/**

- Stores Dart resource files
- Keep implementation details here
- Contains reusable components and helpers

This structure ensures clean separation of concerns and follows Dart best practices for maintainable code.

### Creating the Doc Syncer

Before implementing our MCP server, we need to gather the documentation resources it will use to provide answers. In this section, we'll create a Dart program that downloads Flame engine documentation locally using the GitHub API.

The following diagram shows how the documentation synchronizer interacts with GitHub's API to download and store documentation files:

![Diagram explaining what the sync progress looks like.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/sf769rmvvke7oxwwijho.png)

Let's create a new file called **_flame_doc_syncer.dart_** under the **_bin_** folder. First, we'll implement the main entry point:

```dart
void main() async {
  print('🔄 Syncing Flame Documentation');
  print('==============================');

  final syncer = FlameDocSyncer();

  try {
    await syncer.syncDocs();
    print('✅ Documentation sync completed successfully!');
  } catch (e) {
    print('❌ Sync failed: $e');
    exit(1);
  } finally {
    syncer.dispose();
  }
}
```

Next, we'll create the `FlameDocSyncer` class with the core functionality:

```dart
class FlameDocSyncer {
  FlameDocSyncer({String? githubToken})
      : _githubToken = githubToken ?? Platform.environment['GITHUB_TOKEN'];

  static const String repoApiUrl =
      'https://api.github.com/repos/flame-engine/flame/contents/doc';
  static const String rawBaseUrl =
      'https://raw.githubusercontent.com/flame-engine/flame/main/doc';

  // Use absolute path for cache directory
  static String get cacheDir {
    // Get the directory where the script is located
    final scriptPath = Platform.script.toFilePath();
    final scriptDir =
        File(scriptPath).parent.parent.path; // Go up from bin/ to project root
    return path.join(scriptDir, 'flame_docs_cache');
  }

  final http.Client _client = http.Client();
  final String? _githubToken;

  //TODO: Add the header logic 

  /// Sync documentation from GitHub
  Future<void> syncDocs() async {
    // Show authentication status
    if (_githubToken != null && _githubToken.isNotEmpty) {
      print('🔑 Using GitHub personal access token (higher rate limits)');

      // Check rate limit
      final rateLimitInfo = await getRateLimitStatus();
      if (rateLimitInfo.containsKey('rate')) {
        final rate = rateLimitInfo['rate'];
        print(
            '📊 API Rate Limit: ${rate['remaining']}/${rate['limit']} requests remaining');
        if (rate['remaining'] < 10) {
          print('⚠️  Warning: Low API rate limit remaining!');
        }
      }
    } else {
      print(
          '⚠️  No GitHub token found - using unauthenticated requests (60/hour limit)');
      print(
          '💡 Set GITHUB_TOKEN environment variable for higher limits (5000/hour)');
    }

    // Create cache directory
    final dir = Directory(cacheDir);
    if (await dir.exists()) {
      print('🗑️  Clearing existing cache...');
      await dir.delete(recursive: true);
    }
    await dir.create(recursive: true);
    print('📁 Cache directory: $cacheDir');

    // Fetch all markdown files
    await _fetchDirectory('');

    // Count cached files
    int fileCount = 0;
    await for (final entity in dir.list(recursive: true)) {
      if (entity is File && entity.path.endsWith('.md')) {
        fileCount++;
      }
    }

    print('📚 Cached $fileCount documentation files');
  }

  //TODO: Check rate limit

  //TODO: Add Directory Check

  //TODO: Download file

  //TODO: Dispose logic
}
```

The code above: 

1. Creates the Flame doc syncer object with a GitHub token if provided. If not, it checks the environment variables or keeps it null. The reason for this implementation is to prevent hitting GitHub API limitations when making calls without a personal access token. With the token, we can make 5,000 calls to the GitHub API per hour without hitting any limits. 
2. We define our API doc URLs and the directory to cache the documentation. 
3. Next, we create our HTTP client. 
4. When the syncDocs function is called, it downloads the full documentation.

However, our implementation includes additional checks and logic throughout the process. For instance, we verify if we've reached the API rate limit for the current token using the following code:

```dart
Future<Map<String, dynamic>> getRateLimitStatus() async {
  try {
    final response = await _client.get(
      Uri.parse('https://api.github.com/rate_limit'),
      headers: _getHeaders(),
    );

    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to get rate limit: ${response.statusCode}');
    }
  } catch (e) {
    return {'error': e.toString()};
  }
}

/// Get HTTP headers for GitHub API requests
Map<String, String> _getHeaders() {
  final headers = <String, String>{
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Flame-MCP-Server/1.0',
  };

  if (_githubToken != null && _githubToken.isNotEmpty) {
    headers['Authorization'] = 'token $_githubToken';
  }

  return headers;
}
```
To download all documentation files, including those in subfolders, we implement a recursive download process. The following code handles both individual file downloads at a specific path and complete subfolder traversal when no path is specified:

```dart
Future<void> _fetchDirectory(String relativePath) async {
  final apiUrl =
      relativePath.isEmpty ? repoApiUrl : '$repoApiUrl/$relativePath';

  try {
    final response = await _client.get(
      Uri.parse(apiUrl),
      headers: _getHeaders(),
    );

    if (response.statusCode == 403) {
      // Check if it's a rate limit issue
      final rateLimitRemaining = response.headers['x-ratelimit-remaining'];
      if (rateLimitRemaining == '0') {
        throw Exception(
            'GitHub API rate limit exceeded. Please wait or use a personal access token.');
      }
      throw Exception(
          'Access forbidden: ${response.statusCode}. Check your GitHub token permissions.');
    } else if (response.statusCode != 200) {
      throw Exception('Failed to fetch directory: ${response.statusCode}');
    }

    final List<dynamic> items = jsonDecode(response.body);

    for (final item in items) {
      final name = item['name'] as String;
      final type = item['type'] as String;
      final itemPath = relativePath.isEmpty ? name : '$relativePath/$name';

      if (type == 'dir') {
        // Create local directory and recurse
        final localDir = Directory(path.join(cacheDir, itemPath));
        await localDir.create(recursive: true);
        await _fetchDirectory(itemPath);
      } else if (type == 'file' && name.endsWith('.md')) {
        // Download markdown file
        await _downloadFile(itemPath);
      }
    }
  } catch (e) {
    print('⚠️  Error fetching directory $relativePath: $e');
    rethrow;
  }
}

Future<void> _downloadFile(String remotePath) async {
  final rawUrl = '$rawBaseUrl/$remotePath';
  final localPath = path.join(cacheDir, remotePath);

  try {
    final response = await _client.get(
      Uri.parse(rawUrl),
      headers: _getHeaders(),
    );

    if (response.statusCode == 200) {
      await File(localPath).writeAsString(response.body);
      print('📄 Downloaded: $remotePath');
    } else if (response.statusCode == 403) {
      print('⚠️  Access forbidden for $remotePath: ${response.statusCode}');
    } else {
      print('⚠️  Failed to download $remotePath: ${response.statusCode}');
    }
  } catch (e) {
    print('⚠️  Error downloading $remotePath: $e');
  }
}
```
Finally, implement the dispose method to properly close the HTTP client connection:
```dart
void dispose() {
  _client.close();
}
```

To run the documentation synchronization tool, execute the following command in your terminal:

```dart
dart run bin/flame_doc_syncer.dart
```

### Building the MCP Server

Before implementing the MCP server, let's examine its architecture and core components:

![Architecture diagram on what we are building as the MCP server.](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/vxfmo90vxivyoblmvmia.png)

The diagram illustrates the key components of our MCP server architecture:

1. A client interface for user interaction
2. JSON-RPC for message delivery between client and server
3. Two core tools:
   - A documentation search tool
   - A tutorial retrieval tool
4. A build script to automate the entire process

Before we dive into the server implementation, let's briefly explain JSON-RPC:

![Diagram explaining JSON-RPC protocol showing client-server communication flow  with request and response](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/d0e9rxbtspq0z23bb5hc.png)

JSON-RPC is a lightweight communication protocol that enables remote procedure calls using JSON formatting. Let's explore its key aspects:

#### Core concepts

JSON-RPC operates as a stateless protocol with built-in error handling. It uses a simple request-response pattern:

- The client sends a JSON-formatted request
- The server processes the request
- The server returns a JSON-formatted response

#### Message structure

Every JSON-RPC message includes these required fields:

- jsonrpc: Identifies the protocol version
- id: Matches requests with their corresponding responses
- method: Specifies which function to execute

Request messages contain:

- params: Arguments for the method call

Response messages include either:

- result: Contains successful operation data
- error: Contains error details with codes and messages

#### Transport options

JSON-RPC supports multiple transport methods:

- HTTP/HTTPS: For web APIs and REST services
- WebSocket: For real-time, persistent communication
- stdio: For process-to-process communication (used in our MCP implementation)
- TCP/UDP: For direct network connections

Let's go back to building. First create a _**flame_mcp_live.dart**_ file under **_bin_** folder and start the server from there:

```dart
import 'package:flame_mcp_server/src/flame_mcp_live.dart';

void main() async {
  final server = FlameMcpLive();
  await server.start();
}
```
Now create a file under **_lib/src_** called **_flame_mcp_live.dart_** and start with the implementation: 

```dart
import 'dart:convert';
import 'dart:io';
import 'flame_live_docs.dart';

/// Local MCP server for Flame documentation
class FlameMcpLive {
  final FlameLiveDocs _docs = FlameLiveDocs();

  /// Start the MCP server
  Future<void> start() async {
    // MCP servers must not print to stdout - only JSON-RPC messages
    // Use stderr for logging instead
    stderr.writeln('🎮 Starting Flame MCP Server (Local Mode)');

    // Initialize documentation system
    await _docs.initialize();

    // Start MCP server
    stdin
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(_handleRequest);
  }

  //TODO: Handle Request
  //TODO: Process Request
  //TODO: Handle Initialize
  //TODO: Handle Resource List
  //TODO: Hanle Reading Resources
  //TODO: Handle tools list
  //TODO: Handle tools call
  //TODO: Handle tutorials
}
```

When calling the start function, we initialize the `FlameLiveDocs` class. This separate class follows the single responsibility principle, where each class has one specific purpose:

- FlameDocSyncer: Handles documentation download and caching
- FlameLiveDocs: Manages documentation search and serving

This separation prevents cache management issues by ensuring that:

- Only FlameDocSyncer can modify the documentation cache
- The MCP server (FlameLiveDocs) has read-only access to the cache
- Cache updates occur only when explicitly requested

Let's implement this by adding the following code to **_lib/src/flame_doc_syncer.dart_**:


```dart
import 'dart:io';
import 'package:path/path.dart' as path;

/// Simple, robust live documentation fetcher for Flame engine
class FlameLiveDocs {
  // Use absolute path for cache directory
  static String get cacheDir {
    // Get the directory where the executable is located
    final executablePath = Platform.resolvedExecutable;
    final executableDir = File(executablePath).parent.path;

    // The executable is in build/, so go up one level to project root
    final projectRoot = Directory(executableDir).parent.path;
    return path.join(projectRoot, 'flame_docs_cache');
  }

  /// Initialize the documentation system
  Future<void> initialize() async {
    // Check if cache exists and build index
    final dir = Directory(cacheDir);
    if (await dir.exists()) {
      await _buildIndex();
    }
  }

  // Cache for indexed resources
  List<String>? _cachedResources;

  /// Build index of all cached files
  Future<void> _buildIndex() async {
    final resources = <String>[];
    final dir = Directory(cacheDir);

    if (await dir.exists()) {
      await for (final entity in dir.list(recursive: true)) {
        if (entity is File && entity.path.endsWith('.md')) {
          final relativePath = path.relative(entity.path, from: cacheDir);
          final uri =
              'flame://${relativePath.replaceAll(path.separator, '/').replaceAll('.md', '')}';
          resources.add(uri);
        }
      }
    }

    _cachedResources = resources;
  }

  //TODO: getResources call
  //TODO: getContent call
  //TODO: _sanitizeContent call
  //TODO: search call
  //TODO: searchTutorials call
}
```

With the documentation indexing in place, we can now implement the search functionality in our MCP server. Let's update the **_flame_mcp_live.dart_** file by replacing the TODO items with the key components of this implementation.

#### Core Request Handling

**_handleRequest(String line):**

- Parses and validates incoming JSON-RPC requests
- Routes them to appropriate handlers
- Manages error responses for malformed requests

**_processRequest(Map<String, dynamic> request):
**
- Routes validated requests to specific method handlers
- Supports methods like initialize, tools/list, and resources/read
- Differentiates between notifications and regular requests

```dart
void _handleRequest(String line) async {
  dynamic requestId;
  try {
    // First try to parse the JSON
    final request = jsonDecode(line);

    // Extract the ID for error handling
    requestId = request['id'];

    // Validate required fields
    if (request['jsonrpc'] != '2.0') {
      _sendError(requestId, -32600, 'Invalid JSON-RPC version');
      return;
    }

    if (request['method'] == null) {
      _sendError(requestId, -32600, 'Missing method field');
      return;
    }

    // Check if this is a notification (no id field)
    final isNotification = requestId == null;

    final response = await _processRequest(request);

    // Only send response for requests, not notifications
    if (!isNotification && response.isNotEmpty) {
      final jsonResponse = jsonEncode(response);
      stdout.writeln(jsonResponse);
    }
  } catch (e) {
    // Use the extracted ID if available, otherwise null
    _sendError(requestId, -32700, 'Parse error: $e');
  }
}

Future<Map<String, dynamic>> _processRequest(
    Map<String, dynamic> request) async {
  final method = request['method'] as String?;
  final id = request['id'];
  final params = request['params'] as Map<String, dynamic>?;

  // Check if this is a notification (no id field)
  final isNotification = id == null;

  // Validate that we have a method
  if (method == null || method.isEmpty) {
    if (isNotification) {
      // For notifications, we can't send an error response
      stderr.writeln('Warning: Received notification without method');
      return {};
    }
    return _createError(id, -32600, 'Missing or empty method field');
  }

  switch (method) {
    case 'initialize':
      if (isNotification) {
        stderr.writeln(
            'Warning: Initialize should be a request, not notification');
        return {};
      }
      return _handleInitialize(id);

    case 'notifications/initialized':
      // Handle initialized notification - no response needed
      stderr.writeln('Received initialized notification');
      return {};

    case 'resources/list':
      if (isNotification) {
        stderr.writeln(
            'Warning: resources/list should be a request, not notification');
        return {};
      }
      return await _handleResourcesList(id);

    case 'resources/read':
      if (isNotification) {
        stderr.writeln(
            'Warning: resources/read should be a request, not notification');
        return {};
      }
      return await _handleResourcesRead(id, params);

    case 'tools/list':
      if (isNotification) {
        stderr.writeln(
            'Warning: tools/list should be a request, not notification');
        return {};
      }
      return _handleToolsList(id);

    case 'tools/call':
      if (isNotification) {
        stderr.writeln(
            'Warning: tools/call should be a request, not notification');
        return {};
      }
      return await _handleToolsCall(id, params);

    case 'ping':
      if (isNotification) {
        stderr.writeln('Warning: ping should be a request, not notification');
        return {};
      }
      return _handlePing(id);

    default:
      if (isNotification) {
        stderr.writeln('Warning: Unknown notification method: $method');
        return {};
      }
      return _createError(id, -32601, 'Method not found: $method');
  }
}
```
#### Connection Management

**_handleInitialize(dynamic id):**

- Manages MCP initialization handshake
- Returns server capabilities and protocol version
- Establishes initial connection parameters

```dart
Map<String, dynamic> _handleInitialize(dynamic id) {
  return {
    'jsonrpc': '2.0',
    'id': id,
    'result': {
      'protocolVersion': '2024-11-05',
      'capabilities': {
        'resources': {'listChanged': true},
        'tools': {'listChanged': true},
      },
      'serverInfo': {
        'name': 'flame-mcp-local',
        'version': '1.0.0',
        'description':
            'Local Flame game engine MCP server with on-demand GitHub documentation'
      }
    }
  };
}
```

#### Resource Management

**_handleResourcesList(dynamic id):**

- Provides a catalog of available Flame documentation
- Includes URIs, names, and descriptions

**_handleResourcesRead(dynamic id, Map<String, dynamic>? params):**

- Retrieves documentation content by URI
- Returns formatted content for client consumption

```dart
Future<Map<String, dynamic>> _handleResourcesList(dynamic id) async {
  final resources = await _docs.getResources();

  final resourceList = resources.map((uri) {
    final name = uri.replaceFirst('flame://', '').replaceAll('/', ' > ');
    return {
      'uri': uri,
      'name': 'Flame: $name',
      'description': 'Flame engine documentation: $name',
      'mimeType': 'text/markdown'
    };
  }).toList();

  return {
    'jsonrpc': '2.0',
    'id': id,
    'result': {'resources': resourceList}
  };
}

Future<Map<String, dynamic>> _handleResourcesRead(
    dynamic id, Map<String, dynamic>? params) async {
  final uri = params?['uri'] as String?;
  if (uri == null) {
    return _createError(id, -32602, 'Missing uri parameter');
  }

  final content = await _docs.getContent(uri);
  if (content == null) {
    return _createError(id, -32603, 'Resource not found: $uri');
  }

  // Additional content sanitization for JSON safety
  final safeContent = _safeJsonContent(content);

  return {
    'jsonrpc': '2.0',
    'id': id,
    'result': {
      'contents': [
        {'uri': uri, 'mimeType': 'text/markdown', 'text': safeContent}
      ]
    }
  };
}
```

#### Tools and Tutorial Management

**_handleToolsList(dynamic id):**

- Lists available MCP tools (search_documentation and tutorial)
- Includes tool descriptions and input schemas

**_handleToolsCall(dynamic id, Map<String, dynamic>? params):**        

- Executes requested tools with provided arguments
- Returns formatted results

```dart
Map<String, dynamic> _handleToolsList(dynamic id) {
  final tools = [
    {
      'name': 'search_documentation',
      'description': 'Search through Flame documentation',
      'inputSchema': {
        'type': 'object',
        'properties': {
          'query': {'type': 'string', 'description': 'Search query'}
        },
        'required': ['query']
      }
    },
    {
      'name': 'tutorial',
      'description':
          'Get complete Flame tutorials with step-by-step instructions for building games (space shooter, platformer, klondike). Use this for learning how to build specific games.',
      'inputSchema': {
        'type': 'object',
        'properties': {
          'topic': {
            'type': 'string',
            'description':
                'Tutorial topic: "space shooter" for complete space shooter game tutorial, "platformer" for platformer game tutorial, "klondike" for card game tutorial, or "list" to see all available tutorials'
          }
        },
        'required': ['topic']
      }
    },
  ];

  return {
    'jsonrpc': '2.0',
    'id': id,
    'result': {'tools': tools}
  };
}

Future<Map<String, dynamic>> _handleToolsCall(
    dynamic id, Map<String, dynamic>? params) async {
  final toolName = params?['name'] as String?;
  final arguments = params?['arguments'] as Map<String, dynamic>? ?? {};

  if (toolName == null) {
    return _createError(id, -32602, 'Missing tool name');
  }

  try {
    String result;

    switch (toolName) {
      case 'search_documentation':
        final query = arguments['query'] as String? ?? '';
        if (query.isEmpty) {
          result = '❌ Search query cannot be empty';
        } else {
          final results = await _docs.search(query);
          if (results.isEmpty) {
            result = 'No results found for "$query"';
          } else {
            final buffer = StringBuffer();
            buffer.writeln('Found ${results.length} results for "$query":\n');
            for (final result in results.take(5)) {
              buffer.writeln('📄 **${result['title']}** (${result['uri']})');
              buffer.writeln('   ${result['snippet']}\n');
            }
            result = buffer.toString();
          }
        }
        break;

      case 'tutorial':
        final topic = arguments['topic'] as String? ?? '';
        if (topic.isEmpty) {
          result = '❌ Tutorial topic cannot be empty';
        } else {
          result = await _handleTutorialRequest(topic);
        }
        break;

      default:
        result = 'Unknown tool: $toolName';
    }

    return {
      'jsonrpc': '2.0',
      'id': id,
      'result': {
        'content': [
          {'type': 'text', 'text': result}
        ]
      }
    };
  } catch (e) {
    return _createError(id, -32603, 'Tool execution failed: $e');
  }
}
```
#### Tutorial Processing

**_handleTutorialRequest(String topic):**

- Lists all tutorials
- Provides step-by-step game guides
- Enables tutorial content search

**_getCompleteTutorial(String tutorialName):**

- Assembles comprehensive game tutorials
- Orders steps sequentially
- Supports multiple game types (space shooter, platformer, klondike)

```dart
/// Handle tutorial requests
Future<String> _handleTutorialRequest(String topic) async {
  final lowerTopic = topic.toLowerCase();

  // Handle "list" request to show all available tutorials
  if (lowerTopic == 'list') {
    return await _listAllTutorials();
  }

  // For specific tutorial requests, provide comprehensive step-by-step content
  if (lowerTopic.contains('space shooter') ||
      lowerTopic.contains('spaceshooter')) {
    return await _getCompleteTutorial('space_shooter');
  } else if (lowerTopic.contains('platformer')) {
    return await _getCompleteTutorial('platformer');
  } else if (lowerTopic.contains('klondike')) {
    return await _getCompleteTutorial('klondike');
  }

  // Fallback to search for tutorials matching the topic
  final tutorialResults = await _docs.searchTutorials(lowerTopic);

  if (tutorialResults.isEmpty) {
    return 'No tutorials found for "$topic". Try "list" to see all available tutorials.';
  }

  final buffer = StringBuffer();
  buffer.writeln(
      '🎓 Found ${tutorialResults.length} tutorial(s) for "$topic":\n');

  for (final tutorial in tutorialResults) {
    buffer.writeln('📚 **${tutorial['title']}** (${tutorial['uri']})');
    buffer.writeln('   ${tutorial['snippet']}\n');
  }

  return buffer.toString();
}


/// Get complete tutorial with all steps
Future<String> _getCompleteTutorial(String tutorialName) async {
  final resources = await _docs.getResources();
  final tutorialResources = resources
      .where((uri) => uri.contains('tutorials/$tutorialName/'))
      .toList();

  if (tutorialResources.isEmpty) {
    return 'No tutorial found for "$tutorialName".';
  }

  // Sort to get main tutorial first, then steps in order
  tutorialResources.sort((a, b) {
    final aName = a.split('/').last;
    final bName = b.split('/').last;

    // Main tutorial file comes first
    if (aName == tutorialName) return -1;
    if (bName == tutorialName) return 1;

    // Sort steps numerically
    final aStep = _extractStepNumber(aName);
    final bStep = _extractStepNumber(bName);
    return aStep.compareTo(bStep);
  });

  final buffer = StringBuffer();
  buffer.writeln(
      '🎮 ${_formatTopicName(tutorialName)} Tutorial - Complete Guide\n');
  buffer.writeln('\\=' * 50);
  buffer.writeln();

  for (int i = 0; i < tutorialResources.length; i++) {
    final uri = tutorialResources[i];
    final content = await _docs.getContent(uri);

    if (content != null) {
      final fileName = uri.split('/').last;
      final isMainTutorial = fileName == tutorialName;
      final stepNumber = isMainTutorial ? 0 : _extractStepNumber(fileName);

      if (isMainTutorial) {
        buffer.writeln('📖 **Overview**\n');
      } else {
        buffer.writeln('📝 **Step $stepNumber**\n');
      }

      // Get first few paragraphs of content
      final lines = content.split('\n');
      final contentLines = lines
          .where((line) =>
              line.trim().isNotEmpty &&
              // dev.to does not allow me to put the backsticks together. 
              !line.startsWith('`' + '`' + '`') &&
              !line.startsWith('![') &&
              !line.startsWith('{'))
          .take(10)
          .toList();

      for (final line in contentLines) {
        if (line.startsWith('#')) {
          buffer.writeln('**${line.replaceAll('#', '').trim()}**');
        } else {
          buffer.writeln(line);
        }
      }

      buffer.writeln('\n📄 Full content: $uri\n');
      buffer.writeln('-' * 30);
      buffer.writeln();
    }
  }

  buffer.writeln('💡 **Next Steps:**');
  buffer.writeln('• Use the URIs above to get full content for each step');
  buffer.writeln('• Follow the steps in order for best results');
  buffer.writeln('• Each step builds upon the previous one');

  return buffer.toString();
}

/// List all available tutorials
Future<String> _listAllTutorials() async {
  final resources = await _docs.getResources();
  final tutorials =
      resources.where((uri) => uri.contains('tutorials/')).toList();

  if (tutorials.isEmpty) {
    return 'No tutorials found in the documentation cache.';
  }

  final buffer = StringBuffer();
  buffer.writeln('🎓 Available Flame Tutorials:\n');

  // Group tutorials by main topic
  final tutorialGroups = <String, List<String>>{};

  for (final uri in tutorials) {
    // Parse URI like "flame://tutorials/space_shooter/step_1"
    final parts = uri.replaceFirst('flame://', '').split('/');
    if (parts.length >= 2 && parts[0] == 'tutorials') {
      final mainTopic = parts.length >= 3 ? parts[1] : 'general';
      tutorialGroups.putIfAbsent(mainTopic, () => []).add(uri);
    }
  }

  for (final entry in tutorialGroups.entries) {
    final topic = entry.key;
    final uris = entry.value;

    buffer.writeln('📖 **${_formatTopicName(topic)}**');

    // Sort URIs to show main tutorial first, then steps
    uris.sort((a, b) {
      final aName = a.split('/').last;
      final bName = b.split('/').last;

      // Main tutorial files (same name as directory) come first
      if (aName == topic) return -1;
      if (bName == topic) return 1;

      // Then sort steps numerically
      return aName.compareTo(bName);
    });

    for (final uri in uris) {
      final title = uri.replaceFirst('flame://', '').replaceAll('/', ' > ');
      buffer.writeln('   • $title');
    }
    buffer.writeln();
  }

  buffer
      .writeln('💡 Use `tutorial <topic>` to get specific tutorial content.');
  buffer.writeln(
      '   Example: `tutorial space shooter` or `tutorial platformer`');

  return buffer.toString();
}

/// Format topic name for display
String _formatTopicName(String topic) {
  return topic
      .split('_')
      .map((word) => word[0].toUpperCase() + word.substring(1))
      .join(' ');
}

Map<String, dynamic> _handlePing(dynamic id) {
  return {'jsonrpc': '2.0', 'id': id, 'result': {}};
}
```

#### Utility Functions

**_safeJsonContent(String content):**

- Sanitizes markdown content
- Normalizes line endings
- Ensures safe JSON transmission

**_extractStepNumber(String filename) and _formatTopicName(String topic):**

- Parse and format tutorial metadata
- Enable proper content organization

```dart
/// Safely encode content for JSON transmission
String _safeJsonContent(String content) {
  // Additional safety for JSON encoding
  return content
      .replaceAll('\r\n', '\n') // Normalize line endings
      .replaceAll('\r', '\n') // Handle old Mac line endings
      .replaceAll('\t', '    ') // Replace tabs with spaces
      .replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'),
          ''); // Remove control chars
}

/// Extract step number from filename
int _extractStepNumber(String filename) {
  final match = RegExp(r'step_?(\d+)').firstMatch(filename);
  return match != null ? int.parse(match.group(1)!) : 999;
}
```

#### Error Handling

**_createError(dynamic id, int code, String message) and _sendError(dynamic id, int code, String message):**

- Create standardized error responses
- Handle JSON encoding failures
- Ensure reliable error communication

```dart
Map<String, dynamic> _createError(dynamic id, int code, String message) {
  return {
    'jsonrpc': '2.0',
    'id': id,
    'error': {'code': code, 'message': message}
  };
}

void _sendError(dynamic id, int code, String message) {
  try {
    stdout.writeln(jsonEncode(_createError(id, code, message)));
  } catch (e) {
    // Fallback for encoding errors
    stdout.writeln(
        '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"Internal JSON encoding error"}}');
  }
}
```

The key aspect of this implementation is that we communicate with our server using the JSON-RPC protocol over standard input/output (stdio).

Now, let's implement the final piece of the FlameLiveDocs class:

```dart
/// Get all available documentation resources
Future<List<String>> getResources() async {
  // Return cached resources if available
  if (_cachedResources != null) {
    return _cachedResources!;
  }

  // Build index if not cached
  await _buildIndex();
  return _cachedResources ?? [];
}

/// Get content for a specific resource
Future<String?> getContent(String uri) async {
  final docPath = uri.replaceFirst('flame://', '');
  final filePath = path.join(cacheDir, '$docPath.md');
  final file = File(filePath);

  if (await file.exists()) {
    final content = await file.readAsString();
    return _sanitizeContent(content);
  }

  return null;
}

/// Sanitize content to avoid JSON encoding issues
String _sanitizeContent(String content) {
  // Remove or replace characters that might cause JSON parsing issues
  return content
      // Replace text emoticons that might cause issues
      .replaceAll(':)', '🙂')
      .replaceAll(':(', '🙁')
      .replaceAll(':D', '😀')
      .replaceAll(';)', '😉')
      // Remove control characters except newlines and tabs
      .replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'), '')
      // Ensure content is valid UTF-8
      .replaceAll('\uFFFD', '?'); // Replace replacement character
}

/// Search through documentation
Future<List<Map<String, dynamic>>> search(String query) async {
  final results = <Map<String, dynamic>>[];
  final resources = await getResources();

  for (final uri in resources) {
    try {
      final content = await getContent(uri);
      if (content != null &&
          content.toLowerCase().contains(query.toLowerCase())) {
        final title = uri.replaceFirst('flame://', '').replaceAll('/', ' > ');
        final snippet = _extractSnippet(content, query);

        results.add({
          'uri': uri,
          'title': title,
          'snippet': snippet,
        });
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return results;
}

/// Search specifically through tutorial documentation
Future<List<Map<String, dynamic>>> searchTutorials(String query) async {
  final results = <Map<String, dynamic>>[];
  final resources = await getResources();

  // Filter to only tutorial resources
  final tutorialResources =
      resources.where((uri) => uri.contains('tutorials/')).toList();

  for (final uri in tutorialResources) {
    try {
      final content = await getContent(uri);
      if (content != null &&
          content.toLowerCase().contains(query.toLowerCase())) {
        final title = uri.replaceFirst('flame://', '').replaceAll('/', ' > ');
        final snippet = _extractSnippet(content, query);

        results.add({
          'uri': uri,
          'title': title,
          'snippet': snippet,
        });
      }
    } catch (e) {
      // Skip files that can't be read
    }
  }

  return results;
}

String _extractSnippet(String content, String query) {
  final lines = content.split('\n');
  for (int i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().contains(query.toLowerCase())) {
      final start = (i - 1).clamp(0, lines.length - 1);
      final end = (i + 2).clamp(0, lines.length);
      return lines.sublist(start, end).join('\n').trim();
    }
  }
  return lines.take(3).join('\n').trim();
}
```

- `getResources()` - Returns a list of all available documentation resource URIs, using cached results if available or building the index from the local cache directory if needed.
- `getContent(String uri)` - Retrieves the actual markdown content for a specific documentation resource by converting the URI to a file path and reading the corresponding cached file.
- `_sanitizeContent(String content)` - Cleans markdown content by replacing text emoticons with Unicode emojis, removing control characters, and ensuring valid UTF-8 encoding to prevent JSON parsing issues.
- `search(String query)` - Performs a case-insensitive search across all documentation resources, returning matching results with URI, formatted title, and content snippet for each match.
- `searchTutorials(String query)` - Conducts a focused search specifically within tutorial documentation by filtering resources to only those containing "tutorials/" in their URI path.
- `_extractSnippet(String content, String query) `- Creates a contextual preview by finding the line containing the search query and returning it along with one line before and one line after, or the first three lines if no match is found.

### Running the MCP Server

To launch the MCP server, execute the following command in your terminal:

```bash
dart compile exe bin/flame_mcp_live.dart -o build/flame_mcp_live
```

Now that we have the executable MCP server, we can integrate it into our development process. To do this, we'll add a reference to the executable in our MCP client.

However, running each file separately would make the process more cumbersome. To streamline the development workflow, let's create a shell script to automate the entire process.

```bash
#!/bin/bash

echo "🔨 Building Flame MCP Server (Local)"
echo "===================================="

# Install dependencies
echo "📦 Installing dependencies..."
dart pub get

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create build directory
mkdir -p build

echo "🏗️  Building MCP server..."
dart compile exe bin/flame_mcp_live.dart -o build/flame_mcp_live

if [ $? -ne 0 ]; then
    echo "❌ Failed to build MCP server"
    exit 1
fi

# Make executable
chmod +x build/flame_mcp_live

echo ""
echo "📚 Fetching Flame documentation..."
echo "   • This may take 30-60 seconds depending on network speed"

# Use the standalone sync script to fetch documentation
dart run bin/flame_doc_syncer.dart

if [ $? -ne 0 ]; then
    echo "⚠️  Documentation sync failed, but build completed"
    echo "   You can manually sync later with: dart run bin/flame_sync_standalone.dart"
else
    echo "✅ Documentation cached successfully!"
fi

echo ""
echo "✅ Build completed successfully!"
echo ""
echo "📋 Available:"
echo "   • build/flame_mcp_live           - MCP server (search only)"
echo "   • bin/flame_doc_syncer.dart - Manual documentation sync"
echo ""
echo "📁 Documentation cache:"
echo "   • flame_docs_cache/              - Local Flame documentation"
echo ""
echo "🚀 Usage:"
echo "   # Start MCP server"
echo "   ./build/flame_mcp_live"
echo ""
echo "   # Manual sync (refresh docs)"
echo "   dart run bin/flame_doc_syncer.dart"
echo ""
```
To integrate the MCP server with your MCP client, you need to update the client's configuration file. For example, if you're using Amazon Q Developer, follow these steps:

1. Open the Amazon Q Developer configuration file.
2. Add the following entry to specify the MCP server:

```bash
{
  "mcpServers": {
    "flame-docs": {
      "command": "/absolute/path/to/flame_mcp_server/build/flame_mcp_live"
    }
  }
}
```
After configuring the MCP client, launch the application to verify the integration. You should now see that the client recognizes and can interact with the Flame Engine documentation:

::youtube{id="jdRcGcrRnJI" title="How I Built a Flame Engine MCP Server to Build Flutter Games video 1"}

With the Flame Engine documentation now integrated, you can test the system by asking questions about Flame. Here's an example of how the AI assistant responds to Flame Engine queries:

![Flame collision detection question on Claude](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/bamdo24zbzcjkrprzbll.jpg)

### What can I build by running the MCP Server?

So far, we've built our own MCP server using Dart to handle Flame Engine documentation. But how can we ensure everything is working as expected?

The beauty of this MCP server integration is that it unlocks the ability to build any 2D game idea using the Flame engine with minimal hassle. As a hands-on exercise, we challenge you to use the Amazon Q Developer CLI to create a fancy Pong game and see if you can match the level of polish in our example.

By leveraging the Flame engine documentation and tools accessed through the MCP server, you can rapidly prototype and develop your own creative 2D game projects. Give it a try and let us know how it goes!
::youtube{id="7wkTw6XlYMI" title="How I Built a Flame Engine MCP Server to Build Flutter Games video 2"}

### Wrapping Up

This integration demonstrates how AI tools can accelerate game development workflows. By combining the Flame engine with AI assistance through our MCP server, you can prototype and develop games more efficiently.

To learn more:

- Check out the [Flame MCP Server](https://github.com/salihgueler/flame_mcp_server) project
- Check out the [source code](https://github.com/salihgueler/pong_breakout_game) of the Pong game
- Explore the [Flame engine documentation](https://docs.flame-engine.org/latest/)

If you like the content drop a like to the blog and if you have any questions, drop it as a comment or find me over [LinkedIn](https://linkedin.com/in/salihgueler).
