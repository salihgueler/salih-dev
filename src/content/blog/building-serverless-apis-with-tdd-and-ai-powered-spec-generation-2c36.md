---
title: "Building Serverless APIs with TDD and AI-Powered Spec Generation"
description: "Use AI-assisted specification generation to drive test-first development for serverless APIs, from OpenAPI contracts and unit tests through cloud integration testing."
pubDate: "2026-04-16T14:44:03Z"
updatedDate: "2026-04-17T08:21:22Z"
category: "Serverless"
tags: ["tdd","spec","serverless","aidlc"]
hero:
  src: "https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2F74kyhuk4uqq2i9wv5fzn.jpg"
  alt: "Cover image for Building Serverless APIs with TDD and AI-Powered Spec Generation"
  credit: "DEV Community"
  creditUrl: "https://dev.to/aws/building-serverless-apis-with-tdd-and-ai-powered-spec-generation-2c36"
aiSummary: "Use AI-assisted specification generation to drive test-first development for serverless APIs, from OpenAPI contracts and unit tests through cloud integration testing."
originalUrl: "https://dev.to/aws/building-serverless-apis-with-tdd-and-ai-powered-spec-generation-2c36"
draft: false
---

Test-Driven Development has been around for decades, but most teams still struggle to adopt it consistently. The biggest friction point? Writing specs and tests takes time, especially when you're dealing with the ambiguity of greenfield projects. You're not always sure what the requirements should be, what edge cases to cover, or how to structure your tests before you write the code.

This gets more complicated with serverless architectures. You're juggling Lambda functions, API Gateway configurations, database tables, and event-driven workflows. Traditional TDD assumes you're working in a monolithic environment where you can stub out dependencies easily. In serverless, your "dependencies" are managed AWS services with their own quirks, quotas, and failure modes.

What if you could use AI to generate comprehensive specifications from high-level requirements, then use those specs to drive your test creation and implementation? This is how spec-driven development with AI assistants changes how TDD works in practice.

## The Problem with Traditional TDD in Serverless

Classic TDD follows a simple loop: write a failing test, write code to pass the test, refactor. This works when you know exactly what you're building. But in real projects, requirements are often vague: "*Build an API that handles user registrations*" doesn't tell you what fields are required, what validation rules apply, what error responses look like, or how you'll handle concurrent registrations.

You end up spending hours in planning meetings, writing detailed specification documents, or (more commonly) skipping specs entirely and letting the code become the specification. All three approaches have problems:
- Planning meetings slow down development and documentation gradually becomes obsolete
- Skipping specs means inconsistent implementations and missing edge cases
- Code-as-specification makes onboarding painful and refactoring risky

Serverless adds another layer of complexity. You need to test that your Lambda function works, that API Gateway routes requests correctly, that DynamoDB handles your access patterns, that IAM permissions are configured properly, and that everything scales under load. Unit tests with mocks only get you so far. You need integration tests in the cloud to catch configuration issues, but those are slow and expensive to run constantly.

## Spec-Driven Development: The Missing Layer

Spec-driven development sits between requirements and tests. You start with a formal specification that describes exactly what your system should do, including success cases, error conditions, data formats, and constraints. This spec becomes the contract that your code must fulfill.

The difference from traditional documentation is that specs are executable. You can generate tests from specs, validate implementations against specs, and use specs to generate API documentation or client SDKs automatically. OpenAPI is the most common example, but specs can be more detailed and include business logic constraints that OpenAPI doesn't capture.

Here's where AI comes in. Instead of manually writing specifications, you can use AI to generate comprehensive specs from natural language requirements. An AI assistant trained on API design patterns, AWS best practices, and your existing codebase can produce detailed specs that cover edge cases you might not think of.


![Diagram to showcase the flow that we have explained earlier on](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/5frg6ce40166scimf8cx.png)


## Building a User Registration API with Specs

We'll create a Lambda-backed API for user registration. 

### Step 1: Generate the Specification with AI

Use an AI assistant (we will be using [Kiro](https://kiro.dev/download?trk=7fcac8e0-008e-4fe0-8e3d-f72d7381e919&sc_channel=el)) to generate a formal specification from these requirements. Here's a prompt that works:

```markdown
Given the following requirements for a serverless API endpoint, generate a comprehensive specification that includes:

1. OpenAPI schema with all request/response formats
2. Validation rules with specific regex patterns and constraints
3. Error scenarios with HTTP status codes and error formats
4. Concurrency handling strategy
5. Security considerations
6. DynamoDB table design for the data model

Requirements: Build a user registration endpoint that:
- Accepts email, password, and optional full name
- Validates email format and password strength
- Prevents duplicate registrations
- Returns a user ID on success
- Handles concurrent requests safely
- Logs failed attempts for security monitoring

Format the output as a structured JSON specification that can drive test generation.
```

This spec captures things you might not have specified in the original requirements: password regex pattern, exact error messages, the concurrency strategy using DynamoDB conditional writes, and a field for tracking registration attempts (useful for rate limiting).

```markdown
# User Registration API Specification

## OpenAPI Schema

openapi: 3.0.3
info:
  title: User Registration API
  version: 1.0.0
paths:
  /register:
    post:
      operationId: registerUser
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/RegisterRequest'
      responses:
        '201':
          description: User registered successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RegisterResponse'
        '400':
          description: Validation error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '409':
          description: Email already registered
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
components:
  schemas:
    RegisterRequest:
      type: object
      required: [email, password]
      properties:
        email:
          type: string
          format: email
        password:
          type: string
          format: password
        fullName:
          type: string
    RegisterResponse:
      type: object
      required: [userId, email, createdAt]
      properties:
        userId:
          type: string
          format: uuid
        email:
          type: string
        createdAt:
          type: string
          format: date-time
    ErrorResponse:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
        message:
          type: string
        fields:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              reason:
                type: string

## Validation Rules

### Email

| Rule ID | Constraint | Details |
|---------|-----------|---------|
| EMAIL_FORMAT | Regex pattern | `^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$` |
| EMAIL_LENGTH | Max length | 254 characters |
| — | Transform | Lowercase before storage and uniqueness check |

### Password

| Rule ID | Constraint | Details |
|---------|-----------|---------|
| PWD_MIN_LENGTH | Min length | 8 characters |
| PWD_MAX_LENGTH | Max length | 128 characters |
| PWD_UPPERCASE | Pattern | At least one uppercase letter |
| PWD_LOWERCASE | Pattern | At least one lowercase letter |
| PWD_DIGIT | Pattern | At least one digit |
| PWD_SPECIAL | Pattern | At least one special character |

Full pattern: `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:',.<>?/` `` `~])[A-Za-z\d!@#$%^&*()_+\-=\[\]{}|;:',.<>?/` `` `~]{8,128}$`

### Full Name (optional)

| Rule ID | Constraint | Details |
|---------|-----------|---------|
| NAME_FORMAT | Regex pattern | `^[\p{L}\s'.\-]{1,100}$` |
| NAME_LENGTH | Max length | 100 characters |

## Error Scenarios

| ID | HTTP Status | Code | Message | Trigger |
|----|------------|------|---------|---------|
| MISSING_EMAIL | 400 | VALIDATION_ERROR | Email is required | Missing email field |
| INVALID_EMAIL | 400 | VALIDATION_ERROR | Invalid email format | Email fails pattern |
| MISSING_PASSWORD | 400 | VALIDATION_ERROR | Password is required | Missing password field |
| WEAK_PASSWORD | 400 | VALIDATION_ERROR | Password does not meet strength requirements | Password fails strength rules |
| INVALID_NAME | 400 | VALIDATION_ERROR | Full name contains invalid characters | fullName fails pattern |
| INVALID_JSON | 400 | INVALID_REQUEST | Request body must be valid JSON | Malformed or non-JSON body |
| DUPLICATE_EMAIL | 409 | CONFLICT | An account with this email already exists | ConditionalCheckFailedException from DynamoDB |
| INTERNAL_ERROR | 500 | INTERNAL_ERROR | An unexpected error occurred | Unhandled exception or DynamoDB service error |

## Concurrency Handling

**Strategy:** DynamoDB conditional writes

- **Operation:** `PutItem` with `ConditionExpression: attribute_not_exists(pk)`
- **Partition key:** `USER#<normalized_email>` — the email itself is the uniqueness key
- **Behavior:** If two concurrent requests register the same email, exactly one succeeds (201) and the other receives a 409 (`ConditionalCheckFailedException`)
- **Retry policy:** No retry on `ConditionalCheckFailedException`; map directly to 409
- **Idempotency:** Not idempotent by design — repeated calls with the same email return 409 after first success

## Security Considerations

### Password Handling

- **Algorithm:** bcrypt, cost factor 12
- **Storage:** Store only the bcrypt hash, never plaintext
- **Input sanitization:** Reject null bytes in password input

### Rate Limiting

| Scope | Limit | Implementation |
|-------|-------|---------------|
| Per source IP | 10 requests/minute | API Gateway throttling |
| Global | 1000 requests/minute | API Gateway throttling |

### Failed Attempt Logging

| Event | Logged Data | Destination |
|-------|------------|-------------|
| DUPLICATE_EMAIL | Hashed email, source IP | CloudWatch Logs (structured JSON) |
| VALIDATION_ERROR | Error type, source IP | CloudWatch Logs (structured JSON) |
| INTERNAL_ERROR | Full error, correlation ID | CloudWatch Logs (structured JSON) |

- **Retention:** 90 days
- **Alerting:** CloudWatch alarm on >50 failed registrations per 5 minutes from same IP

### Transport & Headers

- HTTPS only (enforced at API Gateway)
- Max request body size: 10KB
- Response headers:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `Content-Type: application/json`
  - `X-Content-Type-Options: nosniff`

## DynamoDB Table Design

**Table name:** `Users`
**Capacity mode:** PAY_PER_REQUEST
**Point-in-time recovery:** Enabled
**Encryption:** AWS_OWNED_KMS

### Key Schema

| Attribute | Type | Key | Format | Description |
|-----------|------|-----|--------|-------------|
| pk | S | HASH | `USER#<normalized_email>` | Partition key for uniqueness enforcement |

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| pk | S | `USER#user@example.com` |
| userId | S | UUIDv4 |
| email | S | Original email (lowercased) |
| passwordHash | S | bcrypt hash |
| fullName | S | Optional, omitted if not provided |
| createdAt | S | ISO 8601 timestamp |
| updatedAt | S | ISO 8601 timestamp |

### Global Secondary Index

| Index Name | Partition Key | Projection | Purpose |
|-----------|--------------|------------|---------|
| userId-index | userId (S) | ALL | Lookup user by UUID for downstream APIs |

## Test Matrix

### Happy Path

- Valid email + strong password → 201 with userId
- Valid email + strong password + fullName → 201 with userId
- Email with subaddressing (`user+tag@example.com`) → 201

### Validation Errors

- Missing email → 400 VALIDATION_ERROR
- Missing password → 400 VALIDATION_ERROR
- Invalid email format → 400 VALIDATION_ERROR
- Password too short → 400 VALIDATION_ERROR
- Password missing uppercase → 400 VALIDATION_ERROR
- Password missing lowercase → 400 VALIDATION_ERROR
- Password missing digit → 400 VALIDATION_ERROR
- Password missing special char → 400 VALIDATION_ERROR
- fullName with invalid chars → 400 VALIDATION_ERROR
- Empty request body → 400 INVALID_REQUEST
- Non-JSON body → 400 INVALID_REQUEST

### Duplicate Handling

- Register same email twice → first 201, second 409
- Register same email different case → 409 (normalization)

### Concurrency

- Two simultaneous registrations same email → exactly one 201, one 409
- Two simultaneous registrations different emails → both 201

### Security

- Password not returned in response body
- Password stored as bcrypt hash in DynamoDB
- Oversized request body → rejected
- Null bytes in password → rejected
```

This will create a logical structure like the following:


![Architecture flow for the app we built](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/x2x58s39wokip2zecl15.png)


### Step 2: Generate Tests from the Specification

Now use the spec to generate comprehensive tests. You can write **_Generate tests from the <your file name> specs._** Once they are generated run the tests, you should see tests are failing and indicating why are they failing as well:

```bash
Test Suites: 5 failed, 5 total
Tests:       21 failed, 1 passed, 22 total
Snapshots:   0 total
Time:        1.541 s, estimated 2 s
Ran all test suites.
 - Completed in 2.530s

> As expected — 21 of 22 tests fail with 501 (the stub's "Not implemented" 
response). The one passing test is "password not returned in response body" 
which trivially passes since the stub doesn't return any user data.

Summary:

| Suite | Tests | Failing |
|---|---|---|
| Happy Path | 3 | 3 |
| Validation Errors | 11 | 11 |
| Duplicate Handling | 2 | 2 |
| Concurrency | 2 | 2 |
| Security | 4 | 3 |
| Total | 22 | 21 |

Ready for the red → green cycle. Want me to start implementing the handler to make these pass?
```

These tests are comprehensive. They cover the happy path, all error scenarios from the spec, and even a concurrency test that sends two simultaneous requests. 

### Step 3: Implement to Pass the Tests  

Now write the Lambda function to make these tests pass. It depends on you to either write them or allow AI to write it for you. Let's ask AI to write it: 

```bash
> Implement everything needed to cover the specs.
... a few moments after implementation 

> All 22 tests green. Here's what was implemented:

- src/repository.ts — UserRepository interface with putUserIfNotExists contract, plus a setter/getter for dependency injection

- src/handler.ts — full handler with JSON parsing, body size check, email/password/name validation, bcrypt hashing, email normalization, and conditional put for duplicate prevention

- tests/helpers.ts — updated with an InMemoryUserRepository that mimics DynamoDB's conditional write behavior, beforeEach reset for test isolation, and getDynamoDBMock() for the bcrypt storage assertion

The real DynamoDB implementation can be swapped in later by calling setRepository() with a DynamoDB-backed class that uses attribute_not_exists(pk) on PutItem.
```

The implementation follows the spec exactly. The validation logic uses the regex patterns from the spec. Error responses match the error formats from the spec. e.g. you can see below, the concurrency handling uses DynamoDB conditional writes as specified:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { UserRecord, UserRepository } from './repository';

export class DynamoDBUserRepository implements UserRepository {
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async putUserIfNotExists(user: UserRecord): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: user,
          ConditionExpression: 'attribute_not_exists(pk)',
        })
      );
      return true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.name === 'ConditionalCheckFailedException'
      ) {
        return false;
      }
      throw err;
    }
  }
}
```

## Deploy and Test in the Cloud 

To deploy and test in the cloud, we will be asking to deploy the app with [CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html?trk=7fcac8e0-008e-4fe0-8e3d-f72d7381e919&sc_channel=el). It will create the project and allows us to deploy to the cloud through CDK's CLI tools. Ask it to **_deploy the code and run tests on cloud_**.

```bash
> Everything is deployed and tested. Here's the summary:

Stack deployed: ServerlessTddStack in us-east-1
- API Gateway: 
https://62lf8w8qnk.execute-api.us-east-1.amazonaws.com/prod/register
- Lambda: Node 20, 256MB, esbuild-bundled
- DynamoDB: Users table with pk (HASH) + userId-index GSI, PAY_PER_REQUEST, 
PITR enabled

Test results:
- 22 unit tests ✅ (in-memory mock)
- 5 integration tests ✅ (live API)

Files added:
- src/dynamodb-repository.ts — real DynamoDB repo with conditional writes
- src/lambda.ts — Lambda entry point wiring the DynamoDB repo
- infra/stack.ts — CDK stack definition
- infra/app.ts — CDK app entry
- cdk.json — CDK config
- tests/integration.test.ts — live API tests
- jest.integration.config.js — integration test config

Commands:
- npm test — run unit tests
- 
API_ENDPOINT=https://62lf8w8qnk.execute-api.us-east-1.amazonaws.com/prod/register npm run test:integration
— run integration tests
- npm run destroy — tear down the stack
```

Testing in the cloud catches issues that local tests miss: IAM permission problems, DynamoDB throughput limits, API Gateway timeout configurations, and cold start behavior.

## Handling Spec Evolution

Specs aren't static. Requirements change. When they do, regenerate the spec with AI, diff it against the current version, and update tests accordingly.

```bash
Update spec to give user an option to add a profile picture URL. 
```

When you run the diff, you get a clear picture of what changed. 

```bash
> Now I'll update the spec with the profile picture URL field across all 
relevant sections.
I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  57, 57:         fullName:
  58, 58:           type: string
+     59:         profilePictureUrl:
+     60:           type: string
+     61:           format: uri
  59, 62:     RegisterResponse:

Updating: docs/user-registration-spec.md
 - Completed in 0.1s

I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  116, 116: ### Full Name (optional)
  117, 117: 
  118, 118: | Rule ID | Constraint | Details |
  119, 119: |---------|-----------|---------|
  120, 120: | NAME_FORMAT | Regex pattern | `^[\p{L}\s'.\-]{1,100}$` |
  121, 121: | NAME_LENGTH | Max length | 100 characters |
+      122: 
+      123: ### Profile Picture URL (optional)
+      124: 
+      125: | Rule ID | Constraint | Details |
+      126: |---------|-----------|---------|
+      127: | PIC_URL_FORMAT | Regex pattern | `^https://[^\s]{1,2048}$` |
+      128: | PIC_URL_LENGTH | Max length | 2048 characters |
+      129: | PIC_URL_SCHEME | Scheme | Must be HTTPS only |

Updating: docs/user-registration-spec.md
 - Completed in 0.1s

I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  139, 139: | INVALID_NAME | 400 | VALIDATION_ERROR | Full name contains invalid characters | fullName fails pattern |
- 140     : | INVALID_JSON | 400 | INVALID_REQUEST | Request body must be valid JSON | Malformed or non-JSON body |
+      140: | INVALID_PROFILE_PIC_URL | 400 | VALIDATION_ERROR | Profile picture URL must be a valid HTTPS URL | profilePictureUrl fails pattern |
+      141: | INVALID_JSON | 400 | INVALID_REQUEST | Request body must be valid JSON | Malformed or non-JSON body |

Updating: docs/user-registration-spec.md
 - Completed in 0.1s

I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  211, 211: | fullName | S | Optional, omitted if not provided |
+      212: | profilePictureUrl | S | Optional, omitted if not provided |
  212, 213: | createdAt | S | ISO 8601 timestamp |

Updating: docs/user-registration-spec.md
 - Completed in 0.2s

I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  227, 227: - Valid email + strong password + fullName → 201 with userId
+      228: - Valid email + strong password + profilePictureUrl → 201 with userId
  228, 229: - Email with subaddressing (`user+tag@example.com`) → 201

Updating: docs/user-registration-spec.md
 - Completed in 0.1s

I'll modify the following file: docs/user-registration-spec.md (using tool: write)

  241, 241: - fullName with invalid chars → 400 VALIDATION_ERROR
+      242: - profilePictureUrl with HTTP scheme → 400 VALIDATION_ERROR
+      243: - profilePictureUrl with invalid format → 400 VALIDATION_ERROR
  242, 244: - Empty request body → 400 INVALID_REQUEST

Updating: docs/user-registration-spec.md
```

According to your changes, you can add new test cases for added scenarios, remove obsolete tests, and update tests for changed behavior. This keeps your test suite and implementation synchronized with requirements.

## Tradeoffs and When to Use a Different Approach

This mixture of AI and spec-driven approach works well for APIs with complex validation, multiple error conditions, and strict contracts (like public APIs or microservices with many consumers). It's less useful for experimental features where requirements are genuinely unknown.

If you're building a prototype to test a hypothesis, traditional TDD with minimal specs is faster. Write a few high-level tests, implement quickly, and iterate. Once the concept proves valuable, then formalize it with specs.

For workflows with complex business logic but simple I/O contracts, consider property-based testing instead. Tools like fast-check generate random inputs to find edge cases your specs might miss. Combine property tests with spec-driven tests for comprehensive coverage.

For systems with heavy external dependencies (third-party APIs, legacy services), mocks are unavoidable. But keep mocked tests separate from integration tests. Run mocked tests frequently during development for fast feedback. Run cloud integration tests before merging to catch configuration drift.

## Making This Practical

To adopt spec-driven development in your team:
1. Start with one API or service, not the whole system
2. Use AI to generate initial specs, then review and refine them
3. Store specs in version control alongside code
4. Generate tests from specs, but also write additional tests for edge cases you discover
5. Make spec generation part of your development workflow, not a one-time task
6. Review spec diffs in pull requests just like code diffs

The goal is to make specifications a living part of your codebase, not documentation that falls out of date.

## Cleaning Up Resources

When you're done experimenting, delete the CloudFormation stack:

```bash

cdk destroy

```

This removes the API Gateway, Lambda function, and DynamoDB table. Check the AWS Console to confirm no orphaned resources remain.

## Further Reading
- [Lambda Testing Guide](https://docs.aws.amazon.com/lambda/latest/dg/testing-guide.html) - comprehensive testing strategies
- [Serverless Test Samples Repository](https://github.com/aws-samples/serverless-test-samples) - practical examples
- [OpenAPI Specification](https://swagger.io/specification/) - API contract standard
- [Property-Based Testing with fast-check](https://github.com/dubzzz/fast-check) - discover edge cases automatically

Connect with me on [Twitter/X](https://twitter.com/salihgueler), [LinkedIn](https://linkedin.com/in/salihgueler), [GitHub](https://github.com/salihgueler), and [Bluesky](https://bsky.app/profile/salihgueler) at @salih.dev.
