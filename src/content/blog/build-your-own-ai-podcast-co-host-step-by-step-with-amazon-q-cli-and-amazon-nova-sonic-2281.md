---
title: "Build Your Own AI Podcast Co-Host: Step-by-Step with Amazon Q CLI and Amazon Nova Sonic"
description: "Build a voice-based AI podcast co-host with Amazon Q CLI, Amazon Nova Sonic, Next.js, and bidirectional streaming through Amazon Bedrock."
pubDate: "2025-04-08T15:16:02Z"
updatedDate: "2025-04-08T20:46:17Z"
category: "Generative AI"
tags: ["aws","genai","qcli","amazonbedrock"]
hero:
  src: "https://salih.dev/images/blog/2391884-build-your-own-ai-podcast-co-host-step-by-step-with-amazon-q-cli-and-amazon-nova-sonic-2281.webp"
  alt: "Cover image for Build Your Own AI Podcast Co-Host: Step-by-Step with Amazon Q CLI and Amazon Nova Sonic"
  credit: "DEV Community"
  creditUrl: "https://dev.to/salihgueler/build-your-own-ai-podcast-co-host-step-by-step-with-amazon-q-cli-and-amazon-nova-sonic-2281"
aiSummary: "Build a voice-based AI podcast co-host with Amazon Q CLI, Amazon Nova Sonic, Next.js, and bidirectional streaming through Amazon Bedrock."
originalUrl: "https://dev.to/salihgueler/build-your-own-ai-podcast-co-host-step-by-step-with-amazon-q-cli-and-amazon-nova-sonic-2281"
sources: [{"name":"DEV Community","url":"https://dev.to/salihgueler/build-your-own-ai-podcast-co-host-step-by-step-with-amazon-q-cli-and-amazon-nova-sonic-2281"}]
draft: false
---

Ever dreamed of launching a podcast but struggled to find the perfect co-host? You're not alone. While we all have great ideas for content, finding a reliable podcast partner to deliver these ideas can be one of the biggest hurdles for aspiring content creators. But what if AI could solve this challenge? With this guide, you will learn how to build your own AI-powered podcast studio and create a dynamic virtual co-host using [Amazon Q CLI](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) and [Amazon Nova Sonic](https://aws.amazon.com/ai/generative-ai/nova/speech/?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) from scratch.

At the end, you should be able to implement something similar to this:

::youtube{id="99RItQcvSDY" title="Build Your Own AI Podcast Co-Host: Step-by-Step with Amazon Q CLI and Amazon Nova Sonic video 1"}

Requirements:

* Amazon Q CLI
* Amazon Nova Sonic model access is granted
* AWS CLI account configured to use Amazon Bedrock (in this case it is assumed to be named as default)

## Planning

The app will be built with the newly announced Amazon Nova Sonic model. The model offers a state-of-the-art speech recognition and generation model that enables developers to create natural, human-like conversational AI experiences with low latency and industry-leading price performance. 

Next.js app will allow the “human host” of the podcast app to communicate through voice and with the context and conversation it has, it will deliver the natural response back to the app. 

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/i9jqswx750j4sjjbv90o.png)

## Building the Frontend App

We will not be writing our frontend code now. You might be wondering why? Because this way, we will let the AI do the heavy-lifting for the UI and more importantly, we will add the proper code to proper places in our applications, in our control.

First of all, let’s start off by creating your base folder to build our application. Run the following command to create your folder:

```
mkdir podcastapp
```

And run the `q chat` to start your process of building your frontend:

```
You're tasked with creating a modern, responsive web application using Next.js 15 that will serve as
the foundation for migrating an existing Amazon Nova Sonic's Speech-to-Speech application. This new application should maintain all the core functionality of the original while providing an enhanced user experience through a clean, professional design that prioritizes accessibility and usability.

Begin by setting up a Next.js 15 project with the App Router architecture, TypeScript for type safety,
and Tailwind CSS for styling. Incorporate Shadcn/UI components to ensure a consistent design system throughout the application, and use Framer Motion for smooth animations and transitions. The application should be fully responsive, working seamlessly across desktop and mobile devices.

For the project structure, organize your code in a scalable way that will facilitate the future
integration of the actual business logic. Create directories for components, hooks, services, contexts, and types. Within the components directory, separate UI elements into logical categories such as conversation components, audio components, and layout components. This organization will make it easier to maintain and extend the application as it grows.

Implement a modern conversation interface that displays messages from both the user and AI assistant with clear visual distinction between roles. Include animated indicators for "listening," "thinking," and "speaking" states to provide users with feedback on the current system status. The chat container should auto-scroll to show new messages and maintain a clean, readable layout even with lengthy conversations.

Create audio control components that provide intuitive buttons for starting and stopping recording. Include a visual audio waveform component that animates when the user is speaking, providing visual feedback. Implement mock microphone permission handling with clear guidance for users on how to enable their microphone. While the actual audio recording functionality will be integrated later, the UI should fully simulate this behavior.

Develop a session management system that displays connection status, handles initialization flow, and provides appropriate error handling with recovery patterns. Include loading states and transitions to keep users informed about what's happening behind the scenes. This will be crucial for maintaining a good user experience when dealing with real-time audio streaming in the future.

Add a configuration panel that allows users to customize the system prompt, switch between light and dark themes, adjust accessibility settings, and configure mock AWS connection settings. This panel should be easily accessible but not intrusive to the main conversation interface.

For the initial implementation, create mock services that simulate the behavior of the actual services. The mock BedrockService should simulate connection/disconnection, fake audio streaming with appropriate timeouts, and generate plausible responses after a "processing" time. The mock AudioManager should handle fake microphone access requests, simulate recording and playback, and generate visualization data. The mock ConversationManager should maintain conversation state, handle turn-taking logic, and manage thinking/speaking indicators.

Pay special attention to accessibility features by implementing high contrast mode, ensuring screen reader compatibility, supporting keyboard navigation, and managing focus appropriately. These features should be built into the foundation of the application rather than added as an afterthought.

Document all components, hooks, and services with clear explanations of their purpose, props, and usage examples. Include notes about future integration points where the mock implementations will be replaced with actual functionality. This documentation will be invaluable when it's time to integrate the real Amazon Bedrock Nova S2S functionality.

The final deliverable should be a fully functional Next.js 15 application with mock implementations of
all core features, clean and well-documented TypeScript code, a responsive UI that works across devices, clear integration points for future business logic implementation, and basic documentation on project structure and component usage. This foundation will allow for a smooth transition when integrating the actual Amazon Nova Sonic functionality while providing an immediately usable and visually appealing interface.
```

This will create a website according to your description. It might not look the same, but it will look beautiful and modern at the end. 

Here is what I had at one of the iterations:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/adkpmrvpc0mwrz7we5kf.jpg)


## Implementing the Core Service Classes

First, you will add the necessary libraries:

```bash
npm install @aws-sdk/client-bedrock-runtime @aws-sdk/credential-providers @smithy/node-http-handler @smithy/types
```

Then let's add some constants and types to define your configurations, these will be used throughout the application to provide and share information:

```typescript
export const DefaultInferenceConfiguration = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

export const DefaultAudioInputConfiguration = {
  audioType: "SPEECH" as AudioType,
  encoding: "base64",
  mediaType: "audio/lpcm" as AudioMediaType,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

export const DefaultToolSchema = JSON.stringify({
  "$schema": "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {},
  required: [],
});

export const DefaultTextConfiguration = {
  mediaType: "text/plain" as TextMediaType,
};

export const DefaultSystemPrompt = `
You are a podcast co-host. The user and you will engage in a spoken dialog exchanging 
opinions and conversations about AWS. You should ask follow up questions and keep your responses short,
generally two or three sentences for chatty scenarios.
`;

export const DefaultAudioOutputConfiguration = {
  ...DefaultAudioInputConfiguration,
  sampleRateHertz: 24000,
  voiceId: "matthew",
};

export interface InferenceConfig {
  readonly maxTokens: number;
  readonly topP: number;
  readonly temperature: number;
}

export type ContentType = "AUDIO" | "TEXT" | "TOOL";
export type AudioType = "SPEECH";
export type AudioMediaType = "audio/wav" | "audio/lpcm" | "audio/mulaw" | "audio/mpeg";
export type TextMediaType = "text/plain" | "application/json";


export interface AudioConfiguration {
  readonly audioType: AudioType;
  readonly mediaType: AudioMediaType;
  readonly sampleRateHertz: number;
  readonly sampleSizeBits: number;
  readonly channelCount: number;
  readonly encoding: string;
  readonly voiceId?: string;
}

export interface TextConfiguration {
  readonly mediaType: TextMediaType;
}

export interface ToolConfiguration {
  readonly toolUseId: string;
  readonly type: "TEXT";
  readonly textInputConfiguration: {
    readonly mediaType: "text/plain";
  };
}
```

You will start by implementing the `BedrockService` class. It is designed to:

1. Create and manage sessions with Amazon Bedrock's Nova Sonic model
2. Handle audio streaming to the model
3. Register event handlers for different types of responses
4. Properly close sessions and clean up resources

Create it under _services/bedrock/BedrockService.ts_ file:

```typescript
import { S2SBidirectionalStreamClient, StreamSession } from './S2SBidirectionalStreamClient';
import { fromIni } from '@aws-sdk/credential-providers';

export class BedrockService {
  private client: S2SBidirectionalStreamClient;
  private sessions: Map<string, StreamSession> = new Map();
  
  constructor() {
    // Initialize the AWS Bedrock client with configuration
    this.client = new S2SBidirectionalStreamClient({
      requestHandlerConfig: {
        maxConcurrentStreams: 10,
      },
      clientConfig: {
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: fromIni({ profile: process.env.AWS_PROFILE || 'default' })
      }
    });
  }
  
  /**
   * Creates a new session with AWS Bedrock and initializes it with the system prompt
   */
  async createSession(sessionId: string, systemPrompt: string): Promise<void> {
    try {
      // Create a new streaming session
      const session = this.client.createStreamSession(sessionId);
      this.sessions.set(sessionId, session);
      
      // Initialize the session with AWS Bedrock
      await this.client.initiateSession(sessionId);
      
      // Set up the prompt sequence
      await session.setupPromptStart();
      await session.setupSystemPrompt(undefined, systemPrompt);
      await session.setupStartAudio();
      
      console.log(`Session ${sessionId} created successfully`);
    } catch (error) {
      console.error(`Error creating session ${sessionId}:`, error);
      throw error;
    }
  }
  
  /**
   * Streams audio data to AWS Bedrock for processing
   */
  async streamAudio(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    await session.streamAudio(audioData);
  }
  
  /**
   * Registers an event handler for a specific session and event type
   */
  registerEventHandler(
    sessionId: string, 
    eventType: string, 
    handler: (data: any) => void
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    session.onEvent(eventType, handler);
  }
  
  /**
   * Properly closes a session and cleans up resources
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    try {
      // Follow the proper shutdown sequence
      await session.endAudioContent();
      await session.endPrompt();
      await session.close();
      
      // Remove the session from our tracking
      this.sessions.delete(sessionId);
      console.log(`Session ${sessionId} closed successfully`);
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
      // Even if there's an error, remove the session from tracking
      this.sessions.delete(sessionId);
    }
  }
  
  /**
   * Returns all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }
  
  /**
   * Checks if a session is active
   */
  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
```

Next step is to implement the `AudioManager`class which handles:
1. Initializing the Web Audio API context
2. Requesting microphone access from the browser
3. Recording audio from the microphone and converting it to the format required by AWS Bedrock
4. Playing back audio responses received from the server
5. Proper cleanup of audio resources

Create it under _services/audio/AudioManager.ts_:


```typescript
export class AudioManager {
  private audioContext: AudioContext | null = null;
  private audioStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private audioPlayer: any = null; // Will be initialized later
  private isRecording: boolean = false;
  
  /**
   * Initialize the audio context and player
   */
  async initialize(): Promise<void> {
    try {
      // Create audio context with 16kHz sample rate (matching Bedrock's requirements)
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      // Initialize audio player (implementation will be in a separate class)
      this.audioPlayer = new AudioPlayer();
      await this.audioPlayer.start();
      
      console.log('AudioManager initialized successfully');
    } catch (error) {
      console.error('Error initializing AudioManager:', error);
      throw error;
    }
  }
  
  /**
   * Request microphone access from the browser
   */
  async requestMicrophoneAccess(): Promise<boolean> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      return true;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      return false;
    }
  }
  
  /**
   * Start recording audio from the microphone
   * @param onAudioData Callback function that receives audio data
   */
  startRecording(onAudioData: (data: string) => void): void {
    if (!this.audioContext || !this.audioStream) {
      console.error('AudioContext or AudioStream not initialized');
      return;
    }
    
    try {
      this.isRecording = true;
      
      // Create audio source from microphone stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.audioStream);
      
      // Create script processor for audio processing
      this.processor = this.audioContext.createScriptProcessor(512, 1, 1);
      
      // Process audio data
      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert to 16-bit PCM (required by Bedrock)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to base64 for transmission
        const base64Data = this.arrayBufferToBase64(pcmData.buffer);
        
        // Send to callback
        onAudioData(base64Data);
      };
      
      // Connect the audio nodes
      this.sourceNode.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      this.isRecording = false;
    }
  }
  
  /**
   * Stop recording audio
   */
  stopRecording(): void {
    this.isRecording = false;
    
    // Clean up audio processing nodes
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    console.log('Recording stopped');
  }
  
  /**
   * Play audio data received from the server
   * @param audioData Base64 encoded audio data
   */
  playAudio(audioData: string): void {
    if (!this.audioPlayer) {
      console.error('AudioPlayer not initialized');
      return;
    }
    
    try {
      // Convert base64 to Float32Array for playback
      const audioBuffer = this.base64ToFloat32Array(audioData);
      this.audioPlayer.playAudio(audioBuffer);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }
  
  /**
   * Clean up resources when component unmounts
   */
  cleanup(): void {
    this.stopRecording();
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    if (this.audioPlayer) {
      this.audioPlayer.stop();
      this.audioPlayer = null;
    }
    
    console.log('AudioManager cleaned up');
  }
  
  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
  }
  
  /**
   * Convert base64 string to Float32Array for audio playback
   */
  private base64ToFloat32Array(base64String: string): Float32Array {
    const binaryString = window.atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  }
  
  /**
   * Get the current audio context
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
  
  /**
   * Check if recording is active
   */
  isActive(): boolean {
    return this.isRecording;
  }
}

/**
 * Audio Player class for handling audio playback
 * This is a simplified version that would be expanded in the actual implementation
 */
class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private initialized: boolean = false;
  
  async start(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    
    // Load the audio worklet
    await this.audioContext.audioWorklet.addModule('/audio-player-processor.js');
    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-player-processor');
    this.workletNode.connect(this.audioContext.destination);
    
    this.initialized = true;
  }
  
  playAudio(samples: Float32Array): void {
    if (!this.initialized || !this.workletNode) {
      console.error("AudioPlayer not initialized");
      return;
    }
    
    this.workletNode.port.postMessage({
      type: "audio",
      audioData: samples,
    });
  }
  
  stop(): void {
    if (this.audioContext) {
      this.audioContext.close();
    }
    
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
    
    this.initialized = false;
    this.audioContext = null;
    this.workletNode = null;
  }
}
```

Lastly, you will add a conversation manager as your core functionality. The `ConversationManager` class:

1. Manages the state of the conversation, including message history and speaking/thinking indicators
2. Provides methods to update the state and notify listeners
3. Handles message concatenation when multiple messages come from the same role
4. Includes a utility to create a React Context for easy integration with React components

Create it under `services/conversation/ConversationManager.ts`

```typescript
export interface Message {
  role: string;
  content: string;
  timestamp: number;
}

export interface ConversationState {
  messages: Message[];
  isUserSpeaking: boolean;
  isAssistantThinking: boolean;
  isAssistantSpeaking: boolean;
  isConnected: boolean;
}

/**
 * ConversationManager handles the state of the conversation,
 * including message history and speaking/thinking indicators
 */
export class ConversationManager {
  private state: ConversationState;
  private listeners: ((state: ConversationState) => void)[] = [];
  
  constructor() {
    // Initialize with default state
    this.state = {
      messages: [],
      isUserSpeaking: false,
      isAssistantThinking: false,
      isAssistantSpeaking: false,
      isConnected: false
    };
  }
  
  /**
   * Subscribe to state changes
   * @param listener Function to call when state changes
   * @returns Function to unsubscribe
   */
  subscribe(listener: (state: ConversationState) => void): () => void {
    this.listeners.push(listener);
    
    // Call the listener immediately with current state
    listener({...this.state});
    
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Notify all listeners of state changes
   */
  private notifyListeners(): void {
    const stateCopy = {...this.state};
    this.listeners.forEach(listener => listener(stateCopy));
  }
  
  /**
   * Add a new message to the conversation
   * @param role Role of the message sender (USER or ASSISTANT)
   * @param content Content of the message
   */
  addMessage(role: string, content: string): void {
    // Check if the last message is from the same role
    const lastMessage = this.state.messages[this.state.messages.length - 1];
    
    if (lastMessage && lastMessage.role === role) {
      // Update the last message
      const updatedMessages = [...this.state.messages];
      updatedMessages[updatedMessages.length - 1] = {
        ...lastMessage,
        content: lastMessage.content + " " + content,
        timestamp: Date.now(),
      };
      
      this.state.messages = updatedMessages;
    } else {
      // Add a new message
      this.state.messages = [
        ...this.state.messages,
        {
          role,
          content,
          timestamp: Date.now(),
        },
      ];
    }
    
    this.notifyListeners();
  }
  
  /**
   * Set the user speaking state
   * @param isSpeaking Whether the user is speaking
   */
  setUserSpeaking(isSpeaking: boolean): void {
    this.state.isUserSpeaking = isSpeaking;
    this.notifyListeners();
  }
  
  /**
   * Set the assistant thinking state
   * @param isThinking Whether the assistant is thinking
   */
  setAssistantThinking(isThinking: boolean): void {
    this.state.isAssistantThinking = isThinking;
    this.notifyListeners();
  }
  
  /**
   * Set the assistant speaking state
   * @param isSpeaking Whether the assistant is speaking
   */
  setAssistantSpeaking(isSpeaking: boolean): void {
    this.state.isAssistantSpeaking = isSpeaking;
    this.notifyListeners();
  }
  
  /**
   * Set the connection state
   * @param isConnected Whether the WebSocket is connected
   */
  setConnected(isConnected: boolean): void {
    this.state.isConnected = isConnected;
    this.notifyListeners();
  }
  
  /**
   * Clear the conversation history
   */
  clearConversation(): void {
    this.state.messages = [];
    this.notifyListeners();
  }
  
  /**
   * Get the current state
   * @returns Copy of the current state
   */
  getState(): ConversationState {
    return {...this.state};
  }
  
  /**
   * End the current turn in the conversation
   */
  endTurn(): void {
    // This could be expanded to add metadata to messages
    // or perform other actions when a turn ends
    this.notifyListeners();
  }
  
  /**
   * Mark the conversation as ended
   */
  endConversation(): void {
    // This could add a system message or perform cleanup
    this.notifyListeners();
  }
}

/**
 * Create a React Context wrapper for the ConversationManager
 * This would be implemented in a separate file in the actual application
 */
export function createConversationContext() {
  const conversationManager = new ConversationManager();
  
  return {
    useConversation: () => {
      // This would be implemented using React's useState and useEffect
      // to subscribe to the ConversationManager
      return {
        state: conversationManager.getState(),
        addMessage: conversationManager.addMessage.bind(conversationManager),
        setUserSpeaking: conversationManager.setUserSpeaking.bind(conversationManager),
        setAssistantThinking: conversationManager.setAssistantThinking.bind(conversationManager),
        setAssistantSpeaking: conversationManager.setAssistantSpeaking.bind(conversationManager),
        setConnected: conversationManager.setConnected.bind(conversationManager),
        clearConversation: conversationManager.clearConversation.bind(conversationManager),
      };
    }
  };
}
```

### Implementing the Server-side Socket Implementation

To provide a complete Socket.IO integration for both the server and client sides, with proper 
context providers for React components to access the socket functionality and conversation state. The code 
handles:

1. Socket.IO server setup with Next.js integration
2. Client-side socket connection management
3. Event handling for all the bidirectional communication
4. React context providers for easy access to socket and conversation state
5. Proper cleanup and error handling

First create a _server.js_ file with Socket.IO implementation:

```javascript
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { fromIni } = require('@aws-sdk/credential-providers');
const { BedrockService } = require('./services/bedrock/BedrockService');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Create Socket.IO server
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });
  
  // Create BedrockService instance
  const bedrockService = new BedrockService();

  // Socket.IO connection handler
  io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Create a unique session ID for this client
    const sessionId = socket.id;
    
    try {
      // Set up event handlers for this session
      socket.on('promptStart', async () => {
        try {
          console.log('Prompt start received');
          // We'll create the session when system prompt is received
        } catch (error) {
          console.error('Error processing prompt start:', error);
          socket.emit('error', {
            message: 'Error processing prompt start',
            details: error instanceof Error ? error.message : String(error)
          });
        }
      });

      socket.on('systemPrompt', async (data) => {
        try {
          console.log('System prompt received', data);
          await bedrockService.createSession(sessionId, data);
          
          // Set up event handlers for this session
          bedrockService.registerEventHandler(sessionId, 'contentStart', (data) => {
            console.log('contentStart:', data);
            socket.emit('contentStart', data);
          });

          bedrockService.registerEventHandler(sessionId, 'textOutput', (data) => {
            console.log('Text output:', data.content.substring(0, 50) + '...');
            socket.emit('textOutput', data);
          });

          bedrockService.registerEventHandler(sessionId, 'audioOutput', (data) => {
            console.log('Audio output received, sending to client');
            socket.emit('audioOutput', data);
          });

          bedrockService.registerEventHandler(sessionId, 'error', (data) => {
            console.error('Error in session:', data);
            socket.emit('error', data);
          });

          bedrockService.registerEventHandler(sessionId, 'toolUse', (data) => {
            console.log('Tool use detected:', data.toolName);
            socket.emit('toolUse', data);
          });

          bedrockService.registerEventHandler(sessionId, 'toolResult', (data) => {
            console.log('Tool result received');
            socket.emit('toolResult', data);
          });

          bedrockService.registerEventHandler(sessionId, 'contentEnd', (data) => {
            console.log('Content end received');
            socket.emit('contentEnd', data);
          });

          bedrockService.registerEventHandler(sessionId, 'streamComplete', () => {
            console.log('Stream completed for client:', socket.id);
            socket.emit('streamComplete');
          });
          
        } catch (error) {
          console.error('Error processing system prompt:', error);
          socket.emit('error', {
            message: 'Error processing system prompt',
            details: error instanceof Error ? error.message : String(error)
          });
        }
      });

      socket.on('audioInput', async (audioData) => {
        try {
          // Convert base64 string to Buffer
          const audioBuffer = typeof audioData === 'string'
            ? Buffer.from(audioData, 'base64')
            : Buffer.from(audioData);

          // Stream the audio
          await bedrockService.streamAudio(sessionId, audioBuffer);
        } catch (error) {
          console.error('Error processing audio:', error);
          socket.emit('error', {
            message: 'Error processing audio',
            details: error instanceof Error ? error.message : String(error)
          });
        }
      });

      socket.on('stopAudio', async () => {
        try {
          console.log('Stop audio requested, beginning proper shutdown sequence');
          await bedrockService.closeSession(sessionId);
        } catch (error) {
          console.error('Error processing streaming end events:', error);
          socket.emit('error', {
            message: 'Error processing streaming end events',
            details: error instanceof Error ? error.message : String(error)
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        try {
          await bedrockService.closeSession(sessionId);
        } catch (error) {
          console.error('Error during session cleanup:', error);
        }
      });

    } catch (error) {
      console.error('Error setting up session:', error);
      socket.emit('error', {
        message: 'Failed to initialize session',
        details: error instanceof Error ? error.message : String(error)
      });
      socket.disconnect();
    }
  });

  // Periodically check for and close inactive sessions (every minute)
  setInterval(() => {
    console.log("Session cleanup check");
    const activeSessions = bedrockService.getActiveSessions();
    console.log(`Active sessions: ${activeSessions.length}`);
  }, 60000);

  // Start the server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to access the application`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down server...');

    const forceExitTimer = setTimeout(() => {
      console.error('Forcing server shutdown after timeout');
      process.exit(1);
    }, 5000);

    try {
      // First close Socket.IO server
      await new Promise(resolve => io.close(resolve));
      console.log('Socket.IO server closed');

      // Then close all active sessions
      const activeSessions = bedrockService.getActiveSessions();
      console.log(`Closing ${activeSessions.length} active sessions...`);

      await Promise.all(activeSessions.map(async (sessionId) => {
        try {
          await bedrockService.closeSession(sessionId);
          console.log(`Closed session ${sessionId} during shutdown`);
        } catch (error) {
          console.error(`Error closing session ${sessionId} during shutdown:`, error);
        }
      }));

      // Now close the HTTP server
      await new Promise(resolve => server.close(resolve));
      clearTimeout(forceExitTimer);
      console.log('Server shut down');
      process.exit(0);
    } catch (error) {
      console.error('Error during server shutdown:', error);
      process.exit(1);
    }
  });
});
```

For using the socket and relying on its logic, you can use hooks. Create one under _hooks/useSocketIO.ts_

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useConversation } from '@/context/ConversationContext';

export function useSocketIO() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSessionInitialized, setIsSessionInitialized] = useState(false);
  const { 
    addMessage, 
    setUserSpeaking, 
    setAssistantThinking, 
    setAssistantSpeaking,
    setConnected
  } = useConversation();

  // Initialize socket connection
  useEffect(() => {
    // Create socket connection
    const socketInstance = io({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Set up event handlers
    socketInstance.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      setConnected(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
      setConnected(false);
      setIsSessionInitialized(false);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setIsConnected(false);
      setConnected(false);
    });

    socketInstance.on('error', (error) => {
      console.error('Socket error:', error);
    });

    socketInstance.on('textOutput', (data) => {
      console.log('Received text output:', data);

      if (data.role === 'USER') {
        // When user text is received, show thinking indicator for assistant response
        setUserSpeaking(false);
        addMessage(data.role, data.content);
        setAssistantThinking(true);
      }
      else if (data.role === 'ASSISTANT') {
        setAssistantThinking(false);
        setAssistantSpeaking(true);
        addMessage(data.role, data.content);
      }
    });

    socketInstance.on('audioOutput', (data) => {
      if (data.content && window.audioPlayer) {
        try {
          window.audioPlayer.playAudio(base64ToFloat32Array(data.content));
        } catch (error) {
          console.error('Error processing audio data:', error);
        }
      }
    });

    socketInstance.on('contentStart', (data) => {
      console.log('Content start received:', data);
      
      if (data.type === 'AUDIO' && data.role === 'ASSISTANT') {
        setAssistantSpeaking(true);
      }
    });

    socketInstance.on('contentEnd', (data) => {
      console.log('Content end received:', data);
      
      if (data.type === 'AUDIO' && data.role === 'ASSISTANT') {
        setAssistantSpeaking(false);
      }
    });

    socketInstance.on('streamComplete', () => {
      console.log('Stream completed');
      setUserSpeaking(false);
      setAssistantThinking(false);
      setAssistantSpeaking(false);
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, [addMessage, setUserSpeaking, setAssistantThinking, setAssistantSpeaking, setConnected]);

  // Initialize session with system prompt
  const initializeSession = useCallback(async (systemPrompt: string): Promise<boolean> => {
    if (!socket || !isConnected) {
      console.error('Socket not connected');
      return false;
    }

    try {
      socket.emit('promptStart');
      socket.emit('systemPrompt', systemPrompt);
      setIsSessionInitialized(true);
      return true;
    } catch (error) {
      console.error('Failed to initialize session:', error);
      return false;
    }
  }, [socket, isConnected]);

  // Start streaming audio
  const startStreaming = useCallback(async (): Promise<boolean> => {
    if (!socket || !isConnected || !isSessionInitialized) {
      console.error('Socket not ready or session not initialized');
      return false;
    }

    setUserSpeaking(true);
    return true;
  }, [socket, isConnected, isSessionInitialized, setUserSpeaking]);

  // Stop streaming audio
  const stopStreaming = useCallback(async (): Promise<boolean> => {
    if (!socket || !isConnected) {
      console.error('Socket not connected');
      return false;
    }

    socket.emit('stopAudio');
    setUserSpeaking(false);
    return true;
  }, [socket, isConnected, setUserSpeaking]);

  // Send audio chunk to server
  const sendAudioChunk = useCallback((audioData: string): boolean => {
    if (!socket || !isConnected || !isSessionInitialized) {
      return false;
    }

    socket.emit('audioInput', audioData);
    return true;
  }, [socket, isConnected, isSessionInitialized]);

  // Helper function to convert base64 to Float32Array
  const base64ToFloat32Array = (base64String: string): Float32Array => {
    const binaryString = window.atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    return float32Array;
  };

  return {
    isConnected,
    isSessionInitialized,
    initializeSession,
    startStreaming,
    stopStreaming,
    sendAudioChunk
  };
}
```

And, add a context to be passed down to components: 

```typescript
'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useSocketIO } from '@/hooks/useSocketIO';

interface SocketContextType {
  isConnected: boolean;
  isSessionInitialized: boolean;
  initializeSession: (systemPrompt: string) => Promise<boolean>;
  startStreaming: () => Promise<boolean>;
  stopStreaming: () => Promise<boolean>;
  sendAudioChunk: (audioData: string) => boolean;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketIO = useSocketIO();
  
  return (
    <SocketContext.Provider value={socketIO}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
```

Lastly but not least you will implement the client, it is a long file and you will see it at the very end to not disturb you. Let's see a breakdown:

Following implementation is the bidirectional streaming protocol that enables real-time communication with 
Amazon Bedrock:

```typescript
// Creating the bidirectional stream with AWS Bedrock
public async initiateSession(sessionId: string): Promise<void> {
  try {
    // Set up initial events for this session
    this.setupSessionStartEvent(sessionId);

    // Create the bidirectional stream with session-specific async iterator
    const asyncIterable = this.createSessionAsyncIterable(sessionId);

    // Send the command to AWS Bedrock
    const response = await this.bedrockRuntimeClient.send(
      new InvokeModelWithBidirectionalStreamCommand({
        modelId: "amazon.nova-sonic-v1:0",
        body: asyncIterable,
      })
    );

    // Process responses from AWS Bedrock
    await this.processResponseStream(sessionId, response);
  } catch (error) {
    console.error(`Error in session ${sessionId}:`, error);
    // Error handling and cleanup...
  }
}
```
Following async iterator is a critical component that enables the bidirectional streaming:

```typescript
private createSessionAsyncIterable(sessionId: string): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
  const session = this.activeSessions.get(sessionId);
  
  return {
    [Symbol.asyncIterator]: () => {
      return {
        next: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
          try {
            // Wait for items in the queue or close signal
            if (session.queue.length === 0) {
              await Promise.race([
                firstValueFrom(session.queueSignal.pipe(take(1))),
                firstValueFrom(session.closeSignal.pipe(take(1))).then(() => {
                  throw new Error("Stream closed");
                }),
              ]);
            }

            // Get next item from the session's queue
            const nextEvent = session.queue.shift();
            
            return {
              value: {
                chunk: {
                  bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
                },
              },
              done: false,
            };
          } catch (error) {
            // Handle errors and stream closure
            session.isActive = false;
            return { value: undefined, done: true };
          }
        }
      };
    },
  };
}
```

This handles audio streaming with a sophisticated buffering mechanism:

```typescript
// Stream audio for this session
public async streamAudio(audioData: Buffer): Promise<void> {
  // Check queue size to avoid memory issues
  if (this.audioBufferQueue.length >= this.maxQueueSize) {
    // Queue is full, drop oldest chunk
    this.audioBufferQueue.shift();
    console.log("Audio queue full, dropping oldest chunk");
  }

  // Queue the audio chunk for streaming
  this.audioBufferQueue.push(audioData);
  this.processAudioQueue();
}

// Process audio queue for continuous streaming
private async processAudioQueue() {
  if (this.isProcessingAudio || this.audioBufferQueue.length === 0 || !this.isActive)
    return;

  this.isProcessingAudio = true;
  try {
    // Process chunks in batches to avoid overload
    let processedChunks = 0;
    const maxChunksPerBatch = 5;

    while (this.audioBufferQueue.length > 0 && 
           processedChunks < maxChunksPerBatch && 
           this.isActive) {
      const audioChunk = this.audioBufferQueue.shift();
      await this.client.streamAudioChunk(this.sessionId, audioChunk);
      processedChunks++;
    }
  } finally {
    this.isProcessingAudio = false;
    
    // Schedule next processing if needed
    if (this.audioBufferQueue.length > 0 && this.isActive) {
      setTimeout(() => this.processAudioQueue(), 0);
    }
  }
}
```

Here the system processes responses from AWS Bedrock and dispatches appropriate events:

```typescript
private async processResponseStream(sessionId: string, response: any): Promise<void> {
  try {
    for await (const event of response.body) {
      if (event.chunk?.bytes) {
        const textResponse = new TextDecoder().decode(event.chunk.bytes);
        const jsonResponse = JSON.parse(textResponse);
        
        // Handle different response types
        if (jsonResponse.event?.contentStart) {
          this.dispatchEvent(sessionId, "contentStart", jsonResponse.event.contentStart);
        } else if (jsonResponse.event?.textOutput) {
          this.dispatchEvent(sessionId, "textOutput", jsonResponse.event.textOutput);
        } else if (jsonResponse.event?.audioOutput) {
          this.dispatchEvent(sessionId, "audioOutput", jsonResponse.event.audioOutput);
        } else if (jsonResponse.event?.toolUse) {
          // Handle tool use events
          this.dispatchEvent(sessionId, "toolUse", jsonResponse.event.toolUse);
          
          // Store tool use information
          session.toolUseContent = jsonResponse.event.toolUse;
          session.toolUseId = jsonResponse.event.toolUse.toolUseId;
          session.toolName = jsonResponse.event.toolUse.toolName;
        }
        // Additional event handling...
      }
    }
  } catch (error) {
    console.error(`Error processing response stream:`, error);
    // Error handling...
  }
}
```

Here you manage the session's complete lifecycle:

```typescript
// Create a new streaming session
public createStreamSession(sessionId: string = randomUUID()): StreamSession {
  const session: SessionData = {
    queue: [],
    queueSignal: new Subject<void>(),
    closeSignal: new Subject<void>(),
    responseSubject: new Subject<any>(),
    // Additional session properties...
    isActive: true,
    isPromptStartSent: false,
    isAudioContentStartSent: false,
    audioContentId: randomUUID(),
  };

  this.activeSessions.set(sessionId, session);
  return new StreamSession(sessionId, this);
}

// Properly close a session
public async closeSession(sessionId: string): Promise<void> {
  if (this.sessionCleanupInProgress.has(sessionId)) return;
  
  this.sessionCleanupInProgress.add(sessionId);
  try {
    await this.sendContentEnd(sessionId);
    await this.sendPromptEnd(sessionId);
    await this.sendSessionEnd(sessionId);
  } catch (error) {
    console.error(`Error during closing sequence:`, error);
  } finally {
    // Ensure cleanup happens even if there's an error
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.activeSessions.delete(sessionId);
    }
    this.sessionCleanupInProgress.delete(sessionId);
  }
}
```

Here you use the flexible event handling system:

```typescript
// Register an event handler for a session
public registerEventHandler(
  sessionId: string,
  eventType: string,
  handler: (data: any) => void
): void {
  const session = this.activeSessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  session.responseHandlers.set(eventType, handler);
}

// Dispatch events to handlers
private dispatchEvent(sessionId: string, eventType: string, data: any): void {
  const session = this.activeSessions.get(sessionId);
  if (!session) return;

  const handler = session.responseHandlers.get(eventType);
  if (handler) {
    try {
      handler(data);
    } catch (e) {
      console.error(`Error in ${eventType} handler:`, e);
    }
  }

  // Also dispatch to "any" handlers
  const anyHandler = session.responseHandlers.get("any");
  if (anyHandler) {
    anyHandler({ type: eventType, data });
  }
}
```

Here we process the tool for enhanced functionality:

```typescript
private async processToolUse(toolName: string): Promise<Object> {
  const tool = toolName.toLowerCase();

  switch (tool) {
    case "gettimetool":
      const pstTime = new Date().toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
      });
      return {
        timezone: "PST",
        formattedTime: new Date(pstTime).toLocaleTimeString("en-US", {
          hour12: true,
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    case "getdatetool":
      // Date tool implementation...
    default:
      throw new Error(`Tool ${tool} not supported`);
  }
}

// Send tool result back to the model
private async sendToolResult(sessionId: string, toolUseId: string, result: any): Promise<void> {
  // Tool content start event
  this.addEventToSessionQueue(sessionId, {
    event: {
      contentStart: {
        promptName: session.promptName,
        contentName: contentId,
        interactive: false,
        type: "TOOL",
        toolResultInputConfiguration: {
          toolUseId: toolUseId,
          type: "TEXT",
          textInputConfiguration: {
            mediaType: "text/plain",
          },
        },
      },
    },
  });

  // Tool content input event
  const resultContent = typeof result === "string" ? result : JSON.stringify(result);
  this.addEventToSessionQueue(sessionId, {
    event: {
      toolResult: {
        promptName: session.promptName,
        contentName: contentId,
        content: resultContent,
        role: "TOOL",
      },
    },
  });

  // Tool content end event
  this.addEventToSessionQueue(sessionId, {
    event: {
      contentEnd: {
        promptName: session.promptName,
        contentName: contentId,
      },
    },
  });
}
```

## Conclusion
Amazon Nova Sonic opens up many capabilities for users to implement with its easy to use APIs and capabilities. For starting check out the [official documentation](https://docs.aws.amazon.com/nova/latest/userguide/speech.html?trk=8d3c54c2-d407-4b0c-b4b4-9e0c388fe771&sc_channel=el) and [sample apps](https://github.com/aws-samples/amazon-nova-samples). 

For any questions, please drop it as a comment. 


You can find the full file link to client [here](https://gist.github.com/salihgueler/68c01d43ef88e17cc4cb78711aae2c4d).
