---
title: "Building a Geography Game with a Custom Building Block with AWS Blocks"
description: "Build a custom AWS Block that wraps Google Maps, supports offline local development, and powers a geography guessing game that deploys unchanged to AWS."
pubDate: "2026-07-01T18:55:29Z"
updatedDate: "2026-07-02T13:27:20Z"
category: "AWS Blocks"
tags: ["aws","blocks","awsblocks","map"]
hero:
  src: "https://salih.dev/images/blog/3969438-building-a-geography-game-with-a-custom-aws-block-2l01.webp"
  alt: "Cover image for Building a Geography Game with a Custom Building Block with AWS Blocks"
  credit: "DEV Community"
  creditUrl: "https://dev.to/aws/building-a-geography-game-with-a-custom-aws-block-2l01"
aiSummary: "Build a custom AWS Block that wraps Google Maps, supports offline local development, and powers a geography guessing game that deploys unchanged to AWS."
originalUrl: "https://dev.to/aws/building-a-geography-game-with-a-custom-aws-block-2l01"
sources: [{"name":"DEV Community","url":"https://dev.to/aws/building-a-geography-game-with-a-custom-aws-block-2l01"}]
draft: false
---

[AWS Blocks](https://aws.amazon.com/products/developer-tools/blocks?trk=7fcac8e0-008e-4fe0-8e3d-f72d7381e919&sc_channel=el) handles authentication, databases, file storage, AI agents and more out of the box. But what do you do when you need a service it doesn't cover? You write your own block.

In this post, you'll build a custom Building Block that wraps Google Maps and wire it into a playable geography guessing game called **BlocksExplorer** . You'll see the full conditional-export pattern that makes a block work offline in local dev and switch to Google Maps after deployment, with zero code changes in your consumer.

> As of the publish date of this post AWS Blocks is on Developer Preview. The features and the solution might change. For recent version make sure you check the [source code](https://github.com/salihgueler/blocks-explorer) of the project and the [official documentation](https://docs.aws.amazon.com/blocks?trk=7fcac8e0-008e-4fe0-8e3d-f72d7381e919&sc_channel=el). 

## What we're building

BlocksExplorer shows you a photo of a landmark. You click a map to guess where it is. The closer your guess, the more points you earn. A leaderboard tracks each player's single best session across 5 rounds.

::youtube{id="OtPZwEyCgfM" title="Building a Geography Game with a Custom Building Block with AWS Blocks video 1"}

The map and geocoding features come from a **custom block** that wraps Google Maps. During local dev, the block serves a bundled offline SVG map. **No internet connection required.** After deployment, that same block hands the frontend a Google Maps API key and the browser renders a full interactive map.

## Requirements

- Node.js 20+
- npm 10+
- AWS Blocks CLI (`npm create @aws-blocks/blocks-app@latest`)
- For deployment: AWS CLI configured, CDK bootstrapped, a Google Maps JavaScript API key

## The 4-export pattern

Every [Building Block](https://docs.aws.amazon.com/blocks/latest/devguide/custom-building-blocks.html?trk=7fcac8e0-008e-4fe0-8e3d-f72d7381e919&sc_channel=el) in AWS Blocks uses conditional exports in `package.json` to load different code depending on where it runs:

| Export condition | Runs in | Purpose |
|---|---|---|
| `default` | Local dev server | In-memory fake, no AWS or API keys needed |
| `aws-runtime` | Lambda runtime | Production code (SDK calls, env vars) |
| `cdk` | CDK synthesis | Emits CloudFormation resources or wires config |
| `browser` | Frontend bundle | Types or client-side helpers |

Your consumer code never changes. The local dev server doesn't set any special condition, so `default` kicks in and loads the mock. CDK synth passes `--conditions=cdk`, and the Lambda bundler resolves `aws-runtime`. The frontend (Vite) resolves the `browser` condition.

## Building the LocationMap block

Create a `custom-blocks/location-map/` directory in your project with these files:

### types.ts

The shared interface that all implementations conform to. The `MapDescriptor` union type tells the frontend whether to render the offline SVG or load Google Maps:

```typescript
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationMapConfig {
  mapStyle?: string;
  indexName?: string;
}

export interface GeocoderResult {
  coordinates: Coordinates;
  label: string;
  placeId: string;
}

export type MapDescriptor =
  | { offline: true }
  | { offline: false; googleMapsApiKey: string };

export interface LocationMapService {
  reverseGeocode(coords: Coordinates): Promise<GeocoderResult | null>;
  getMapDescriptor(): Promise<MapDescriptor>;
}

export declare class LocationMap implements LocationMapService {
  reverseGeocode(coords: Coordinates): Promise<GeocoderResult | null>;
  getMapDescriptor(): Promise<MapDescriptor>;
}
```

The `declare class` at the bottom emits no JavaScript. It exists so TypeScript can type-check `import { LocationMap }` without loading a runtime file. The concrete implementations live in `mock.ts` and `aws.ts`.

### geocode.ts (shared logic)

Both mock and deployed implementations need reverse geocoding. Since this game uses a fixed location set, we can share one function between both exports with no external API calls:

```typescript
import type { Coordinates, GeocoderResult } from "./types";

const FIXTURE_PLACES = [
  { name: "Shibuya Crossing", coordinates: { lat: 35.6595, lng: 139.7004 }, country: "Japan", city: "Tokyo" },
  { name: "Taj Mahal", coordinates: { lat: 27.1751, lng: 78.0421 }, country: "India", city: "Agra" },
  { name: "Brandenburg Gate", coordinates: { lat: 52.5163, lng: 13.3777 }, country: "Germany", city: "Berlin" },
  // ... 7 more locations
];

function haversineDistance(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function reverseGeocodeFixture(coords: Coordinates): GeocoderResult {
  let nearest = FIXTURE_PLACES[0];
  let minDist = Infinity;
  for (const place of FIXTURE_PLACES) {
    const dist = haversineDistance(coords, place.coordinates);
    if (dist < minDist) {
      minDist = dist;
      nearest = place;
    }
  }
  return {
    coordinates: nearest.coordinates,
    label: `${nearest.name}, ${nearest.city}, ${nearest.country}`,
    placeId: `fixture-${nearest.name.toLowerCase().replace(/\s+/g, "-")}`,
  };
}
```

This finds the nearest known place via haversine distance. Both `mock.ts` and `aws.ts` import it.

### mock.ts (local development)

The mock runs during `npm run dev`. It returns `{ offline: true }` to signal the frontend to use the bundled SVG map. No API keys, no network, **works completely offline**:

```typescript
import type { Coordinates, GeocoderResult, MapDescriptor } from "./types";
import { reverseGeocodeFixture } from "./geocode";

export class LocationMap {
  async reverseGeocode(coords: Coordinates): Promise<GeocoderResult | null> {
    return reverseGeocodeFixture(coords);
  }

  getMapDescriptor(): Promise<MapDescriptor> {
    return Promise.resolve({ offline: true });
  }
}
```

Same class name, same method signatures as the deployed version. The only difference is what `getMapDescriptor()` returns.

### aws.ts (deployed Lambda)

The production implementation reads the Google Maps API key from the Lambda environment and hands it to the frontend. If no key is configured, it gracefully falls back to the offline SVG:

```typescript
import type { Coordinates, GeocoderResult, MapDescriptor } from "./types";
import { reverseGeocodeFixture } from "./geocode";

export class LocationMap {
  async reverseGeocode(coords: Coordinates): Promise<GeocoderResult | null> {
    return reverseGeocodeFixture(coords);
  }

  async getMapDescriptor(): Promise<MapDescriptor> {
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      return { offline: true };
    }
    return { offline: false, googleMapsApiKey };
  }
}
```

The `GOOGLE_MAPS_API_KEY` env var is injected by the CDK construct at deploy time.

### cdk.ts (infrastructure wiring)

Google Maps is an external provider, so there's no AWS resource to provision. The CDK construct's only job is to wire the API key into the Lambda environment:

```typescript
import { Construct } from "constructs";
import type { Function as LambdaFunction } from "aws-cdk-lib/aws-lambda";

export { LocationMap } from "./mock";

export interface LocationMapCdkProps {
  googleMapsApiKey?: string;
}

export class LocationMapCdk extends Construct {
  private readonly googleMapsApiKey: string;

  constructor(scope: Construct, id: string, props?: LocationMapCdkProps) {
    super(scope, id);
    this.googleMapsApiKey = props?.googleMapsApiKey ?? "";
  }

  configureBackend(handler: LambdaFunction): void {
    handler.addEnvironment("GOOGLE_MAPS_API_KEY", this.googleMapsApiKey);
  }
}
```

Two things to note here:

- The `export { LocationMap } from "./mock"` re-export exists because CDK synth imports `aws-blocks/index.ts` (which instantiates `new LocationMap()`). The lightweight mock satisfies that import without pulling in production dependencies.
- `configureBackend` is a pattern for blocks that need to inject config into the Lambda handler. Call it after creating the stack's handler.

### browser.ts (types for the frontend)

The browser export provides only types. No runtime code ships to the frontend from this package:

```typescript
export type { Coordinates, GeocoderResult, LocationMapConfig } from "./types";
```

### package.json (wiring it together)

```json
{
  "name": "@blocks-explorer/location-map",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "browser": "./browser.ts",
      "cdk": "./cdk.ts",
      "aws-runtime": "./aws.ts",
      "types": "./types.ts",
      "default": "./mock.ts"
    },
    "./cdk": "./cdk.ts"
  },
  "dependencies": {
    "@googlemaps/js-api-loader": "^2.1.1",
    "aws-cdk-lib": "2.260.0",
    "constructs": "^10.6.0"
  },
  "devDependencies": {
    "@types/google.maps": "^3.65.2"
  }
}
```

The `"./cdk"` sub-export lets `index.cdk.ts` import the CDK construct directly (`from "@blocks-explorer/location-map/cdk"`) without triggering the mock class on the main export path.

## Wiring the block into the CDK stack

In `aws-blocks/index.cdk.ts`, instantiate the construct and call `configureBackend`:

```typescript
import { LocationMapCdk } from "@blocks-explorer/location-map/cdk";

// ... after BlocksStack.create() ...

const locationMap = new LocationMapCdk(blocksStack, "LocationMap", {
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
});
locationMap.configureBackend(blocksStack.handler);
```

The `GOOGLE_MAPS_API_KEY` comes from `.env.production` (never committed to git). The `npm run deploy` script loads it into the process env before CDK synth runs.

## The game backend

The backend combines `AuthBasic` (player accounts with week-long sessions), `DistributedTable` (session state and leaderboard), and the custom `LocationMap` (geocoding and map config):

```typescript
import {
  Scope,
  ApiNamespace,
  DistributedTable,
  DistributedTableErrors,
  AuthBasic,
  isBlocksError,
} from "@aws-blocks/blocks";
import { z } from "zod";
import { LocationMap } from "@blocks-explorer/location-map";

const scope = new Scope("be");
const maps = new LocationMap();

const auth = new AuthBasic(scope, "auth", {
  sessionDuration: 86400 * 7,
  passwordPolicy: { minLength: 6 },
});
```

Two `DistributedTable`s back the game. One for active sessions, one for the leaderboard:

```typescript
const sessions = new DistributedTable(scope, "sessions", {
  schema: sessionSchema,
  key: { partitionKey: "sessionId" },
});

const leaderboard = new DistributedTable(scope, "lb", {
  schema: z.object({
    pk: z.string(),
    sk: z.string(),
    username: z.string(),
    points: z.number(),
    guesses: z.number(),
    achievedAt: z.number(),
  }),
  key: { partitionKey: "pk", sortKey: "sk" },
});
```

The API uses the `new ApiNamespace(scope, "api", ...)` constructor. It takes a scope, a name, and a factory function that receives the request context. The `getMapConfig` method exposes the block's map descriptor to the frontend:

```typescript
export const api = new ApiNamespace(scope, "api", (context) => ({
  async getMapConfig() {
    const descriptor = await maps.getMapDescriptor();
    return {
      isOffline: descriptor.offline,
      googleMapsApiKey: descriptor.offline ? null : descriptor.googleMapsApiKey,
      attribution: descriptor.offline ? "Offline SVG Map" : "© Google",
    };
  },

  async startSession() {
    const user = await auth.requireAuth(context);
    const rounds = pickSessionRounds();
    // ... create session, store server-side, return first round
  },

  async submitGuess(sessionId: string, guessLat: number, guessLng: number) {
    const user = await auth.requireAuth(context);
    // ... validate session, score the guess, advance round pointer
    const placeInfo = await maps.reverseGeocode({ lat: round.lat, lng: round.lng });
    // ... return result with label from the block
  },

  async getLeaderboard() { /* ... */ },
}));
```

The frontend calls `api.getMapConfig()` on load and renders either the offline SVG or an interactive Google Map based on the response.

## Error handling

The session architecture needs protection against duplicate submissions. What happens if a player's browser retries a failed request, or they double-click the submit button? The answer is **optimistic locking** via `ifFieldEquals`:

```typescript
try {
  await sessions.put(updatedSession, {
    ifFieldEquals: { currentRound: index },
  });
} catch (e) {
  if (isBlocksError(e, DistributedTableErrors.ConditionalCheckFailed)) {
    throw new Error("That round was already submitted");
  }
  throw e;
}
```

You catch it with `isBlocksError(e, DistributedTableErrors.ConditionalCheckFailed)`, a type-safe error matcher from the blocks SDK. This pattern gives you atomic compare-and-swap semantics without any external locking infrastructure.

## The offline map: local dev without internet

The custom block pattern pays off visually in the map. The `LocationMap` block controls what the player sees on screen:

| Environment | Map rendering | Source |
|---|---|---|
| `npm run dev` | Bundled SVG with pan and zoom | `public/world-map.svg` (zero network) |
| Deployed | Google Maps JavaScript API | Full vector tiles, street-level zoom |

The frontend calls `api.getMapConfig()` on mount and picks the right renderer:

- **Offline mode**: fetches `/world-map.svg` (served by Vite from `public/`), renders it inline, and converts clicks to coordinates using equirectangular projection math:

```typescript
// SVG viewBox is "0 0 360 180", trivial coordinate conversion
const x = ((e.clientX - rect.left) / rect.width) * 360;
const y = ((e.clientY - rect.top) / rect.height) * 180;
const lng = x - 180;
const lat = 90 - y;
```

- **Online mode**: initializes Google Maps via `@googlemaps/js-api-loader` using the API key from `getMapConfig()`.

The SVG map lives at `public/world-map.svg`, 177 countries rendered in an equirectangular projection. It works without internet because Vite serves the file directly from the `public/` folder during `npm run dev`, the same way it serves your `index.html`. The component supports **scroll-to-zoom** (up to 8×) and **click-and-drag panning**, so players can zoom into a region for more precise pin placement. Markers scale inversely with zoom so they stay readable at any level. No tile server, no CDN, no external dependencies. You can develop this game on a plane.

The 4-export pattern goes deeper than the server. It flows all the way through to the user experience. The `mock.ts` export signals "offline", the backend exposes that signal via `getMapConfig()`, and the frontend adapts. Same `getMapDescriptor()` method call, completely different rendering, but with the same interaction model (click to guess, zoom to refine).

## Running it

```bash
npm install
npm run dev
```

::youtube{id="KYhkM7cFOV0" title="Building a Geography Game with a Custom Building Block with AWS Blocks video 2"}

The offline SVG map renders instantly. No environment variables, no API keys, no `.env` file needed for local development.

## Deploying to AWS

Create a `.env.production` file with your Google Maps JavaScript API key (restrict it by HTTP referrer in the Google Cloud console):

```bash
echo "GOOGLE_MAPS_API_KEY=AIza..." > .env.production
```

Then deploy:

```bash
npm run deploy
```

AWS Blocks provisions everything your app needs: the DynamoDB tables for sessions and the leaderboard, the auth backend, and your custom block's env var injection. Same code you wrote for local dev, now running on AWS.

![Deployment output with API URL and Resource IDs](https://dev-to-uploads.s3.us-east-2.amazonaws.com/uploads/articles/z31i8ksvys0g9fxs1f7y.jpg)

Once deployed, the game looks and plays the same, but now you're on Google Maps with full zoom, satellite imagery, and Street View integration. You can see the difference in the map: the deployed version renders crisp vector tiles at every zoom level with labels and terrain. The offline SVG served its purpose during development (zero-config and no credentials needed) but now the `aws.ts` export takes over.

::youtube{id="OtPZwEyCgfM" title="Building a Geography Game with a Custom Building Block with AWS Blocks video 3"}

### Cleaning up

```bash
npm run destroy
```

This removes the CloudFormation stack including the DynamoDB tables, Lambda functions, and API Gateway.

## What you've learned

Building a custom block follows one pattern:

1. Define your types and shared logic (`types.ts`, `geocode.ts`)
2. Write the mock (fixture data, offline signals)
3. Write the AWS implementation (reads env vars, calls external APIs)
4. Write the CDK construct (provisions resources or injects config)
5. Wire the conditional exports in `package.json`

But the deeper insight: custom blocks can wrap **any provider**, not only AWS services. Google Maps, Stripe, Twilio, your internal APIs. The CDK construct's job might be as simple as injecting an API key into the Lambda environment. And the mock enables a fully offline local development experience: the offline SVG map, the fixture geocoding data, the local auth. All of it works without a network connection. When you deploy, the same code uses real services.

The full source code is on GitHub: [blocks-explorer](https://github.com/salihgueler/blocks-explorer). If you want to try the custom block in your own project, copy the `custom-blocks/location-map/` directory into your workspace, add it to your `package.json` workspaces, and swap in your own Google Maps API key.
