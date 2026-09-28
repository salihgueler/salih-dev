# Requirements Document

## Introduction

The talk upload endpoint extends the existing restricted content API of the salih.dev personal website so the Author can add a PDF slide deck, and optionally a complete talk record, without a repository commit.

Repository inspection established the ground this feature builds on. The IAM-authorized HTTP API `salih-dev-content` exposes `GET /v1/content` and `PUT /v1/content`, authorizes exactly one account root ARN from an environment-supplied allowlist, caps JSON bodies at 65,536 bytes, writes one fixed object key with conditional preconditions, triggers the publisher build project, and is throttled at the stage. The completed talks-section feature owns the talk field rules: a strict content schema, pure validators, build-time PDF asset validation with an exact-pinned parser, safe root-relative slide paths beneath `/talks/slides/`, one validated read gateway that every talk-derived output resolves through, and static build verification that reads author-managed source records from `src/content/talks/` and proves a one-to-one mapping between published records and published slide files. The publisher build already materializes remote content into the source tree before generation, copying the site content object and synchronizing blog posts and blog images from the private content bucket.

Two consequences shape these requirements. First, PDF bytes that arrive over the network are untrusted input, so validation cannot be deferred to the build alone. Second, once talk metadata can arrive over the API, talk records become dual-sourced, so precedence and conflict behavior must be deterministic and one talk can never be described by two records.

The published Talks archive is currently empty by intent. This feature adds a mechanism only; it introduces no talk content.

## Glossary

- **Author**: Salih Güler or a trusted maintainer who manages salih.dev content through the website's existing author-controlled publication process.
- **Root_Editor**: The single account root identity that the Content_API already authorizes for content changes, obtained as temporary credentials through the established `aws login` session workflow.
- **Allowlisted_Caller_ARNs**: The exact, code-configured set of caller ARNs the Content_API accepts, which contains only the Root_Editor ARN.
- **Content_API**: The existing IAM-authorized HTTP API named `salih-dev-content` that serves versioned content routes for the Site.
- **Talk_Upload_API**: The single Content_API capability added by this feature that accepts a Talk_Upload_Request, issues a Slide_Upload_Grant, performs Deck_Validation, and records an API_Authored_Talk_Record.
- **Talk_Upload_Request**: One signed request to the Talk_Upload_API that declares an intended PDF_Slide_Deck transfer and optionally carries a Talk_Metadata_Payload.
- **Slide_Upload_Grant**: A short-lived, code-owned authorization returned by the Talk_Upload_API that permits the Root_Editor to transfer PDF bytes for exactly one Deck_Object directly to the Deck_Store without sending those bytes in a Talk_Upload_Request body.
- **Deck_Store**: The private, encrypted, retained storage location that holds Deck_Objects, using the same storage protections as existing Site content storage.
- **Deck_Object**: One stored PDF byte stream in the Deck_Store, addressed by a Derived_Storage_Key.
- **Derived_Storage_Key**: The storage key and file name of a Deck_Object, computed entirely by Site code from validated values.
- **Pending_Deck**: A Deck_Object that has been transferred but has not passed Deck_Validation.
- **Approved_Deck**: A Deck_Object that has passed Deck_Validation and is eligible to become a PDF_Slide_Deck of a Talk_Record.
- **Deck_Validation**: The server-side validation the Talk_Upload_API performs on transferred PDF bytes, covering declared media type, byte size, PDF signature, complete document parse, and page count.
- **Talk_Metadata_Payload**: The optional JSON talk fields carried by a Talk_Upload_Request.
- **Approved_Talk_Fields**: The exact talk field set and value rules already enforced for author-managed talk records by Build_Validation, comprising title, event name, Talk_Date, Talk_Location, Conference_Website_URL, Event_Type_Tag values, PDF_Slide_Deck association, optional Video_URL, and draft state.
- **Git_Authored_Talk_Record**: A Talk_Record stored in the repository under `src/content/talks/` and changed only through a repository commit.
- **API_Authored_Talk_Record**: A Talk_Record created from a Talk_Metadata_Payload and stored in the API_Talk_Store.
- **API_Talk_Store**: The private, encrypted, retained storage location that holds API_Authored_Talk_Records.
- **Talk_Identity**: The code-derived canonical key of a Talk_Record, computed from that record's Talk_Date and title by case-folding and collapsing internal whitespace.
- **Talk_Record_Snapshot**: The single set of Talk_Records, drawn from both Git_Authored_Talk_Records and API_Authored_Talk_Records, that one Publication_Build validates and from which every talk-derived output is generated.
- **Record_Conflict**: The condition in which two Talk_Records in one Talk_Record_Snapshot share a Talk_Identity, or two Talk_Records reference the same PDF_Slide_Deck.
- **Publication_Build**: One execution of the Site publisher that materializes remote content into the source tree, validates it, generates the Site, verifies the generated output, and publishes only on success.
- **Build_Validation**: The deterministic validation the Site performs on Talk_Records before publication, as defined by the talks-section feature.
- **Static_Build_Verification**: The existing post-generation verification of the built Site, including the Talks archive invariants that compare author-managed source records with generated HTML, Markdown, slide files, and Discovery_Documents.
- **Talk_Record**: Structured content for one presentation, containing the Approved_Talk_Fields.
- **Published_Talk**: A Talk_Record that has passed Build_Validation and is included in the public Site build.
- **PDF_Slide_Deck**: A PDF document hosted by the Site and associated with one Talk_Record.
- **Talk_Date**, **Talk_Location**, **Conference_Website_URL**, **Event_Type_Tag**, **Video_URL**: As defined by the talks-section feature.
- **Talks_Page**: The canonical public HTML page at `/talks/` that lists Published_Talk records.
- **Tracked_Slide_Directory**: The repository directory `public/talks/slides/` that holds every slide deck included in a Site build, served under the root-relative prefix `/talks/slides/`.
- **Machine_Readable_Representation**: The Markdown representation of a public page, as defined by the talks-section feature.
- **Discovery_Documents**: The Site's public sitemap and language-model-oriented content indexes.
- **Upload_Log_Record**: One structured log entry the Talk_Upload_API emits for an authorization decision, a validation outcome, or a store change.
- **Visitor**: A person or automated client accessing the public salih.dev website without authoring privileges.

## Requirements

### Requirement 1: Restrict upload access to the existing allowlisted caller

**User Story:** As the Author, I want the upload capability to accept only the identity the content API already trusts, so that adding upload does not widen who can change the Site.

#### Acceptance Criteria

1. THE Talk_Upload_API SHALL require every Talk_Upload_Request to carry a valid AWS Signature Version 4 signature verified by the Content_API's IAM authorization.
2. THE Talk_Upload_API SHALL treat exactly the Allowlisted_Caller_ARNs as authorized callers and SHALL derive that set from the same code-configured allowlist the existing content routes use, containing only the Root_Editor ARN.
3. IF a Talk_Upload_Request carries no signature, an invalid signature, or an expired signature, THEN THE Content_API SHALL reject the request with an authentication failure status and SHALL make no change to the Deck_Store or the API_Talk_Store.
4. IF a Talk_Upload_Request is signed by an identity whose caller ARN is absent from the Allowlisted_Caller_ARNs, THEN THE Talk_Upload_API SHALL reject the request with an authorization failure status, SHALL make no change to the Deck_Store or the API_Talk_Store, and SHALL issue no Slide_Upload_Grant.
5. THE Talk_Upload_API SHALL accept credentials only as temporary session credentials of the Root_Editor and SHALL require no additional caller identity, no long-lived access key, and no interactive sign-in.
6. THE Talk_Upload_API SHALL apply the Content_API stage request-rate and burst limits already configured for existing content routes.
7. WHEN the Site infrastructure is synthesized, THE Content_API SHALL expose every talk upload route with the same IAM authorizer used by the existing content routes and SHALL expose no talk upload route that permits unauthenticated invocation.

### Requirement 2: Accept one upload request for both deck-only and deck-with-metadata use

**User Story:** As the Author, I want a single endpoint that either stages a slide deck alone or publishes a complete talk with that deck, so that I can choose per upload without learning two interfaces.

#### Acceptance Criteria

1. THE Talk_Upload_API SHALL expose exactly one versioned Content_API route that accepts a Talk_Upload_Request.
2. THE Talk_Upload_Request SHALL treat the Talk_Metadata_Payload as an optional member.
3. WHEN the Talk_Upload_API accepts a Talk_Upload_Request that omits a Talk_Metadata_Payload, THE Talk_Upload_API SHALL issue exactly one Slide_Upload_Grant and SHALL record no API_Authored_Talk_Record.
4. WHEN the Talk_Upload_API accepts a Talk_Upload_Request that includes a valid Talk_Metadata_Payload, THE Talk_Upload_API SHALL issue exactly one Slide_Upload_Grant and SHALL associate that grant's Deck_Object with the resulting API_Authored_Talk_Record.
5. WHEN the Talk_Upload_API issues a Slide_Upload_Grant, THE Talk_Upload_API SHALL return the Derived_Storage_Key reference and the grant expiry instant for that grant in the response.
6. IF a Talk_Upload_Request contains a member that is not part of the request contract owned by Site code, THEN THE Talk_Upload_API SHALL reject the request with a validation failure status naming the unsupported member and SHALL make no change to the Deck_Store or the API_Talk_Store.
7. IF a Talk_Upload_Request body exceeds 65,536 bytes, THEN THE Talk_Upload_API SHALL reject the request with a payload-size failure status and SHALL make no change to the Deck_Store or the API_Talk_Store.

### Requirement 3: Transfer slide-deck bytes outside the request body

**User Story:** As the Author, I want slide decks of realistic size to upload reliably, so that a multi-megabyte deck is not blocked by request body limits.

#### Acceptance Criteria

1. THE Slide_Upload_Grant SHALL permit exactly one write of exactly one Deck_Object at exactly one Derived_Storage_Key in the Deck_Store.
2. THE Slide_Upload_Grant SHALL expire no later than 900 seconds after the Talk_Upload_API issues it.
3. THE Slide_Upload_Grant SHALL constrain the transfer to the declared media type `application/pdf` and to a byte size of 1 to 26,214,400 bytes inclusive.
4. THE Slide_Upload_Grant SHALL permit only the write of its own Deck_Object and SHALL permit no read, list, overwrite, or delete of any other object in the Deck_Store or in Site content storage.
5. IF a transfer presents an expired Slide_Upload_Grant, THEN THE Deck_Store SHALL reject the transfer and SHALL retain the previously stored bytes at that Derived_Storage_Key unchanged.
6. IF a transfer presents a media type other than `application/pdf` or a byte size outside the range in criterion 3, THEN THE Deck_Store SHALL reject the transfer and SHALL create no Pending_Deck for that transfer.
7. WHILE a Deck_Object has not passed Deck_Validation, THE Talk_Upload_API SHALL treat that Deck_Object as a Pending_Deck and SHALL exclude it from every Talk_Record_Snapshot.

### Requirement 4: Validate untrusted PDF bytes on the server

**User Story:** As the Author, I want uploaded PDF bytes proven valid before they are eligible for publication, so that an unreadable or non-PDF file is rejected at upload rather than surfacing later.

#### Acceptance Criteria

1. WHEN a Pending_Deck transfer completes, THE Deck_Validation SHALL read the stored bytes and evaluate them against criteria 2 through 6 of this requirement before the Deck_Object becomes an Approved_Deck.
2. THE Deck_Validation SHALL require the stored bytes to have a recorded media type of `application/pdf` and a byte size of 1 to 26,214,400 bytes inclusive.
3. THE Deck_Validation SHALL require the stored bytes to begin with the byte sequence `%PDF-`.
4. THE Deck_Validation SHALL require every page of the stored document to parse successfully with the same exact-pinned PDF parser and strict, non-recovery parsing mode already used by Build_Validation.
5. THE Deck_Validation SHALL require the parsed document to contain at least 1 page.
6. IF the stored bytes are encrypted such that the document cannot be read without a password, THEN THE Deck_Validation SHALL reject the Deck_Object.
7. IF Deck_Validation rejects a Deck_Object, THEN THE Talk_Upload_API SHALL return a validation failure status that names the violated criterion of this requirement, SHALL record no Approved_Deck for those bytes, and SHALL record no API_Authored_Talk_Record that references those bytes.
8. WHEN Deck_Validation accepts a Deck_Object, THE Talk_Upload_API SHALL record that Deck_Object as an Approved_Deck together with its validated byte size and page count.
9. THE Publication_Build SHALL apply Build_Validation to every Approved_Deck it materializes, in addition to the Deck_Validation already performed at upload.

### Requirement 5: Derive storage keys and slide paths in code

**User Story:** As the Author, I want file names and storage locations chosen by Site code, so that a caller-supplied name cannot place a file outside its intended location.

#### Acceptance Criteria

1. THE Talk_Upload_API SHALL compute every Derived_Storage_Key from values it controls, comprising the code-owned Deck_Store prefix and a code-generated unique identifier with the `.pdf` extension.
2. THE Talk_Upload_API SHALL derive the root-relative slide path of each Approved_Deck from that Approved_Deck's Derived_Storage_Key, as a path beneath `/talks/slides/` that satisfies the existing safe-slide-path rules.
3. IF a Talk_Upload_Request supplies a storage key, file name, slide path, or any other value intended to determine where bytes are stored, THEN THE Talk_Upload_API SHALL reject the request with a validation failure status naming the unsupported member and SHALL issue no Slide_Upload_Grant.
4. THE Talk_Upload_API SHALL produce a Derived_Storage_Key that contains no path traversal segment, no path separator other than the separators of the code-owned prefix, no whitespace, no control character, and no percent-encoded sequence.
5. THE Talk_Upload_API SHALL produce a distinct Derived_Storage_Key for each Slide_Upload_Grant it issues.
6. WHEN the Publication_Build materializes an Approved_Deck, THE Publication_Build SHALL place that Approved_Deck at the root-relative slide path derived in criterion 2 and SHALL resolve that location inside the Tracked_Slide_Directory.
7. IF a materialized Approved_Deck would resolve outside the Tracked_Slide_Directory or would replace a Git-tracked slide file, THEN THE Publication_Build SHALL fail before generating the Site and SHALL publish no output.

### Requirement 6: Validate API talk metadata against the approved talk rules

**User Story:** As the Author, I want metadata sent over the API held to the same rules as metadata committed to the repository, so that the API cannot introduce a talk record the repository would reject.

#### Acceptance Criteria

1. THE Talk_Upload_API SHALL validate every Talk_Metadata_Payload against the same Approved_Talk_Fields value rules that Build_Validation applies to Git_Authored_Talk_Records, using one shared implementation of those rules.
2. THE Talk_Upload_API SHALL accept in a Talk_Metadata_Payload only the Approved_Talk_Fields other than the PDF_Slide_Deck association, and SHALL derive the PDF_Slide_Deck association of an API_Authored_Talk_Record from the Approved_Deck of the same Talk_Upload_Request.
3. IF a Talk_Metadata_Payload omits a required Approved_Talk_Field, contains a field value that violates the Approved_Talk_Fields rules, or contains a member outside the Approved_Talk_Fields, THEN THE Talk_Upload_API SHALL reject the request with a validation failure status that reports each invalid member with the acceptance criterion it violates and SHALL record no API_Authored_Talk_Record.
4. WHEN the Talk_Upload_API accepts a Talk_Metadata_Payload, THE Talk_Upload_API SHALL record an API_Authored_Talk_Record whose stored values are exactly the validated values of that payload plus the derived PDF_Slide_Deck association.
5. WHERE a Talk_Metadata_Payload omits the draft state, THE Talk_Upload_API SHALL apply the same default draft state that Build_Validation applies to a Git_Authored_Talk_Record that omits it.
6. THE Publication_Build SHALL apply Build_Validation to every API_Authored_Talk_Record it materializes, using the same rules, diagnostics, and rejection behavior it applies to Git_Authored_Talk_Records.
7. IF Build_Validation rejects a materialized API_Authored_Talk_Record, THEN THE Publication_Build SHALL fail, SHALL publish no output derived from any Talk_Record, and SHALL preserve the stored API_Authored_Talk_Record without modification.

### Requirement 7: Resolve dual-sourced talk records deterministically

**User Story:** As the Author, I want one deterministic rule for records that exist in both the repository and the API store, so that a talk can never be published with two inconsistent descriptions.

#### Acceptance Criteria

1. THE Talk_Record_Snapshot SHALL contain every Git_Authored_Talk_Record and every API_Authored_Talk_Record that references an Approved_Deck, with each record present exactly once.
2. THE Publication_Build SHALL compute the Talk_Identity of every Talk_Record in the Talk_Record_Snapshot using one shared code-owned derivation, independent of that record's source.
3. WHERE a Talk_Identity is held by exactly one Talk_Record, THE Publication_Build SHALL generate the outputs for that Talk_Identity from that single record.
4. IF a Record_Conflict exists in the Talk_Record_Snapshot, THEN THE Publication_Build SHALL fail before publication, SHALL report the conflicting Talk_Identity or PDF_Slide_Deck together with the source of each conflicting record, and SHALL publish no output derived from any Talk_Record.
5. THE Publication_Build SHALL treat the Git_Authored_Talk_Record as authoritative for a conflicting Talk_Identity in every diagnostic and remediation instruction it reports, and SHALL require removal of the conflicting API_Authored_Talk_Record to resolve that conflict.
6. THE Publication_Build SHALL materialize API_Authored_Talk_Records into a code-owned location that is distinct from the locations of Git_Authored_Talk_Records, and SHALL leave every Git_Authored_Talk_Record and every Git-tracked slide file unmodified.
7. IF a Talk_Upload_Request would create an API_Authored_Talk_Record whose Talk_Identity is already held by a stored API_Authored_Talk_Record, THEN THE Talk_Upload_API SHALL reject the request with a conflict status naming that Talk_Identity, SHALL record no additional API_Authored_Talk_Record, and SHALL issue no Slide_Upload_Grant.
8. THE Talk_Record_Snapshot SHALL include no API_Authored_Talk_Record whose referenced Deck_Object is a Pending_Deck and no API_Authored_Talk_Record whose referenced Deck_Object is absent from the Deck_Store.

### Requirement 8: Publish from one validated snapshot

**User Story:** As an automated client, I want the human-readable and machine-readable talk outputs to agree, so that the published Site remains one consistent description of the talk archive regardless of where each record came from.

#### Acceptance Criteria

1. WHEN a Publication_Build starts, THE Publication_Build SHALL materialize every API_Authored_Talk_Record and every referenced Approved_Deck into the source tree before Build_Validation runs.
2. THE Publication_Build SHALL generate the Talks_Page, its Machine_Readable_Representation, and the talk entries of the Discovery_Documents from one Talk_Record_Snapshot resolved through the existing validated read gateway.
3. THE Publication_Build SHALL materialize each Approved_Deck that is referenced by a Talk_Record in the Talk_Record_Snapshot and SHALL materialize no Approved_Deck that no Talk_Record in that snapshot references.
4. WHEN a Publication_Build completes successfully, THE Static_Build_Verification SHALL have confirmed its existing Talks archive invariants against the materialized source records and the generated output.
5. THE Publication_Build SHALL retain the existing Static_Build_Verification checks and their existing strictness for both Git_Authored_Talk_Records and API_Authored_Talk_Records.
6. IF Build_Validation or Static_Build_Verification fails during a Publication_Build, THEN THE Publication_Build SHALL publish no generated output and SHALL preserve the previously published Site.
7. WHEN the Talk_Upload_API records an Approved_Deck or an API_Authored_Talk_Record, THE Talk_Upload_API SHALL start exactly one Publication_Build and SHALL return the identifier of that Publication_Build in the response.
8. IF the Talk_Upload_API records an Approved_Deck or an API_Authored_Talk_Record and the Publication_Build fails to start, THEN THE Talk_Upload_API SHALL return a publication-not-started status that identifies the stored records and SHALL retain those stored records.

### Requirement 9: Replace and remove uploaded decks and records

**User Story:** As the Author, I want to correct or withdraw an uploaded deck and its record, so that a mistaken upload can be fixed without a repository commit and without ambiguous duplicates.

#### Acceptance Criteria

1. THE Talk_Upload_API SHALL require a Talk_Upload_Request that intends to replace a stored Approved_Deck or a stored API_Authored_Talk_Record to identify the target record and to carry the version precondition returned when that record was last stored.
2. IF a replacing Talk_Upload_Request carries a version precondition that does not match the stored version of its target, THEN THE Talk_Upload_API SHALL reject the request with a precondition failure status and SHALL leave the stored Approved_Deck and API_Authored_Talk_Record unchanged.
3. IF a Talk_Upload_Request identifies an existing target and carries no version precondition, THEN THE Talk_Upload_API SHALL reject the request with a precondition-required status and SHALL leave the stored Approved_Deck and API_Authored_Talk_Record unchanged.
4. WHEN the Talk_Upload_API accepts a replacing Talk_Upload_Request, THE Talk_Upload_API SHALL store the replacement, SHALL retain exactly one current API_Authored_Talk_Record for the affected Talk_Identity, and SHALL return the new stored version.
5. THE Talk_Upload_API SHALL provide a removal operation that requires the same authorization as a Talk_Upload_Request, an explicit removal intent, and the version precondition of the target record.
6. WHEN the Talk_Upload_API accepts a removal request for an API_Authored_Talk_Record, THE Talk_Upload_API SHALL remove that record and its associated Approved_Deck from the Talk_Record_Snapshot of every subsequent Publication_Build and SHALL start exactly one Publication_Build.
7. WHEN a Publication_Build completes successfully after a removal, THE Site SHALL present no talk entry, slide file, Machine_Readable_Representation entry, or Discovery_Documents entry derived from the removed record.
8. IF a removal request identifies a Talk_Identity held only by a Git_Authored_Talk_Record, THEN THE Talk_Upload_API SHALL reject the request with a conflict status stating that the record is repository-authored and SHALL leave the API_Talk_Store unchanged.

### Requirement 10: Preserve existing observability and privacy limits

**User Story:** As the Author, I want upload activity observable with the Site's existing privacy posture, so that troubleshooting is possible without collecting new personal data.

#### Acceptance Criteria

1. WHEN the Talk_Upload_API evaluates authorization for a Talk_Upload_Request, THE Talk_Upload_API SHALL emit one Upload_Log_Record containing the action name, the authorization outcome, the caller ARN, and the request identifier, matching the field set already logged by the existing content write path.
2. WHEN the Talk_Upload_API completes Deck_Validation, THE Talk_Upload_API SHALL emit one Upload_Log_Record containing the action name, the validation outcome, the Derived_Storage_Key, the validated byte size, the validated page count, and the request identifier.
3. WHEN the Talk_Upload_API stores an Approved_Deck or an API_Authored_Talk_Record, THE Talk_Upload_API SHALL emit one Upload_Log_Record containing the action name, the stored version, the started Publication_Build identifier, and the request identifier.
4. THE Upload_Log_Record SHALL contain only fields listed in criteria 1 through 3 of this requirement and SHALL contain no client IP address, no forwarded IP address, no cookie, no query string, no user agent, no referrer, and no browser or device identifier.
5. THE Upload_Log_Record SHALL contain no PDF byte content and no rendered page content of a Deck_Object.
6. THE Talk_Upload_API SHALL store Upload_Log_Records with the same log retention period already configured for the existing Content_API functions.
7. THE Deck_Store and the API_Talk_Store SHALL remain private, TLS-only, server-side encrypted, and retained under the same storage protections as existing Site content storage.
8. THE Site SHALL make no change to Visitor-facing analytics collection, aggregation, storage, or retention as part of this feature.

### Requirement 11: Hold the feature to its approved scope

**User Story:** As the Author, I want the upload capability limited to the approved surface, so that it adds no public interface, no new identity, and no unapproved infrastructure action.

#### Acceptance Criteria

1. THE Site SHALL expose no public HTML page, form, or Visitor-facing control that submits a Talk_Upload_Request or performs a slide-deck transfer.
2. THE Site SHALL authorize talk uploads only for the Allowlisted_Caller_ARNs and SHALL introduce no additional editor identity, no hosted login interface, and no additional identity provider.
3. THE Talk_Upload_API SHALL apply the Approved_Talk_Fields rules, the Deck_Validation rules, and the Static_Build_Verification checks at the strictness already established, and SHALL introduce no path by which a Talk_Record or PDF_Slide_Deck reaches the published Site with weaker validation.
4. THE Site SHALL keep the repository the only mechanism by which a Git_Authored_Talk_Record or a Git-tracked slide file is added, changed, or removed.
5. THE feature SHALL introduce no talk content, so the published Talks archive SHALL contain exactly the Published_Talk records the Author supplies through the repository or the Talk_Upload_API.
6. THE feature SHALL treat production deployment of the Site infrastructure as an action requiring separate explicit approval from the Author.
7. THE feature SHALL treat any change to domain name records or name servers as an action requiring separate explicit approval from the Author.
