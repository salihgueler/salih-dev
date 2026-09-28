# Requirements Document

## Introduction

The Talks section adds a public `/talks/` destination to the salih.dev personal website. The section presents Salih Güler's conference and community talks with event metadata, event-type filtering, a website-hosted PDF slide deck, and an optional embedded video.

Repository inspection found author-controlled source and build-time content workflows plus a restricted content API, but no visitor-facing upload or administration workflow. Accordingly, PDF slide decks are author-managed website content. This feature does not introduce an end-user upload or public administration workflow.

## Glossary

- **Author**: Salih Güler or a trusted maintainer who manages salih.dev content through the website's existing author-controlled publication process.
- **Author_Managed_Content_Workflow**: The author-controlled process used to add, validate, publish, replace, or remove website content and static assets; the process excludes visitor-facing upload and public administration controls.
- **Visitor**: A person or automated client accessing the public salih.dev website without authoring privileges.
- **Site**: The salih.dev static website, including human-readable pages and machine-readable representations.
- **Primary_Navigation**: The shared site header navigation rendered on public HTML pages.
- **Talks_Section**: The Site capability that publishes, presents, filters, and exposes talk content.
- **Talks_Page**: The canonical public HTML page at `/talks/` that lists Published_Talk records.
- **Talk_Record**: Author-managed structured content for one presentation, containing a title, conference or event name, Talk_Date, Talk_Location, Conference_Website_URL, one or more Event_Type_Tag values, one PDF_Slide_Deck, and an optional Video_URL.
- **Published_Talk**: A Talk_Record that has passed Build_Validation and is included in the public Site build.
- **Talk_Date**: The calendar date on which a talk was delivered, represented in author-managed content as a valid `YYYY-MM-DD` date.
- **Talk_Location**: A non-empty human-readable place description, such as a venue with city and country or an online-event designation.
- **Conference_Website_URL**: A valid HTTPS address for the conference or event associated with a Talk_Record.
- **Event_Type_Tag**: An author-defined, non-empty label that classifies a talk by conference or event type, such as conference, community event, meetup, workshop, or webinar.
- **PDF_Slide_Deck**: A PDF document supplied through the Author_Managed_Content_Workflow, hosted by the Site, and associated with one Talk_Record.
- **Video_URL**: A valid HTTPS address for a video that the Site can present as an Embedded_Video.
- **Embedded_Video**: An inline video player associated with a Talk_Record and labeled with the talk title.
- **Talk_Filter**: The Visitor-facing control that selects an Event_Type_Tag and limits the visible Published_Talk records to matching records.
- **Machine_Readable_Representation**: A Markdown representation that exposes the public meaning and links of the Talks_Page without requiring interpretation of the HTML presentation.
- **Discovery_Documents**: The Site's public sitemap and language-model-oriented content indexes that enumerate canonical public content.
- **Build_Validation**: The deterministic validation performed before the Site publishes author-managed content.

## Requirements

### Requirement 1: Discover the Talks section

**User Story:** As a Visitor, I want a clearly labeled Talks destination, so that I can find the author's presentations from any public page.

#### Acceptance Criteria

1. WHILE a Visitor is viewing any Site page available without authentication, THE Primary_Navigation SHALL display exactly one visible link labeled "Talks" with `/talks/` as its destination.
2. WHEN a Visitor activates the Talks link, THE Site SHALL navigate to `/talks/` and display the Talks_Page.
3. WHILE the Visitor is viewing the Talks_Page, THE Primary_Navigation SHALL identify the Talks link with both a visible current-page indicator and an assistive-technology-readable current-page state.
4. WHILE the Visitor is viewing the Talks_Page, THE Talks_Page SHALL display exactly one visible level-one heading with the text "Talks".
5. WHILE the Visitor is viewing the Talks_Page, THE Site SHALL set the document title to exactly "Talks".

### Requirement 2: Define publishable talk content

**User Story:** As an Author, I want each talk to use consistent validated metadata, so that every published entry is complete and reliable.

#### Acceptance Criteria

1. THE Talk_Record SHALL contain a title of 1 to 200 Unicode characters after leading and trailing whitespace is removed.
2. THE Talk_Record SHALL contain a conference or event name of 1 to 200 Unicode characters after leading and trailing whitespace is removed.
3. THE Talk_Record SHALL contain exactly one Talk_Date representing a real calendar date in ISO 8601 full-date format.
4. THE Talk_Record SHALL contain exactly one Talk_Location of 1 to 200 Unicode characters after leading and trailing whitespace is removed.
5. THE Talk_Record SHALL contain exactly one Conference_Website_URL that is a syntactically valid absolute HTTPS URL of 1 to 2,048 characters and includes a host.
6. THE Talk_Record SHALL contain 1 to 10 unique Event_Type_Tag values, each containing 1 to 50 Unicode characters after leading and trailing whitespace is removed.
7. THE Talk_Record SHALL contain exactly one PDF_Slide_Deck that Build_Validation can read as a non-empty PDF document.
8. WHERE a talk has a recording, THE Talk_Record SHALL contain exactly one Video_URL that is a syntactically valid absolute HTTPS URL of 1 to 2,048 characters, includes a host, and identifies a supported embeddable provider.
9. IF a Talk_Record omits a field required by criteria 1 through 7, contains more or fewer values than those criteria permit, or contains a value that violates criteria 1 through 8 or criterion 10, THEN THE Build_Validation SHALL reject the public Site build, preserve the Talk_Record source without modification, and report each invalid field with an error indicating the violated criterion.
10. WHERE a talk has published source code, THE Talk_Record SHALL contain exactly one Source_Code_URL that is a credential-free absolute HTTPS URL on the canonical `github.com` host (accepting the `www.github.com` alias, which normalizes to `github.com`) with a non-empty repository path, and SHALL reject deceptive suffix hosts, look-alike hosts, subdomains, non-HTTPS protocols, and pathless values.

### Requirement 3: Present the talk archive

**User Story:** As a Visitor, I want to scan complete talk summaries, so that I can identify relevant presentations and related event information.

#### Acceptance Criteria

1. WHEN a Visitor requests the Talks_Page, THE Talks_Section SHALL present each Published_Talk exactly once, present no unpublished talks, and order the presented talks by Talk_Date from latest to earliest, with any order permitted among talks having the same Talk_Date.
2. THE Talks_Section SHALL display the title associated with each Published_Talk exactly once within that talk's presented information.
3. THE Talks_Section SHALL display the conference or event name associated with each Published_Talk exactly once within that talk's presented information.
4. THE Talks_Section SHALL display the Talk_Location associated with each Published_Talk exactly once within that talk's presented information.
5. THE Talks_Section SHALL display each Talk_Date using the full month name, calendar day as one or two digits, and four-digit year.
6. THE Talks_Section SHALL display each Event_Type_Tag assigned to a Published_Talk exactly once within that talk's presented information and SHALL display no Event_Type_Tag not assigned to that Published_Talk.
7. THE Talks_Section SHALL present each Conference_Website_URL as a link whose label is the associated conference or event name and whose destination is that Conference_Website_URL.
8. IF no Published_Talk records exist, THEN THE Talks_Page SHALL present a message indicating that no talks are currently published and SHALL present no talk information.

### Requirement 4: Filter talks by event type

**User Story:** As a Visitor, I want to filter talks by conference or event type, so that I can focus on presentations from relevant event formats.

#### Acceptance Criteria

1. WHEN the Talks_Page completes its initial load, THE Talks_Section SHALL present each Published_Talk record exactly once and no records that are not Published_Talk records.
2. THE Talk_Filter SHALL provide exactly one selectable Event_Type_Tag option for each distinct Event_Type_Tag assigned to at least one Published_Talk and no Event_Type_Tag options that are not assigned to a Published_Talk.
3. THE Talk_Filter SHALL provide exactly one selectable option labeled "All talks" in addition to the Event_Type_Tag options.
4. WHEN a Visitor selects an Event_Type_Tag option, THE Talks_Section SHALL present each Published_Talk record assigned that Event_Type_Tag exactly once and no Published_Talk records that are not assigned that Event_Type_Tag.
5. WHEN a Visitor selects the "All talks" option, THE Talks_Section SHALL present each Published_Talk record exactly once and no records that are not Published_Talk records.
6. WHILE an Event_Type_Tag option is selected, THE Talk_Filter SHALL display a visible selected-state indicator on that option that does not rely on color alone.
7. IF a selected Event_Type_Tag has no matching Published_Talk records, THEN THE Talks_Section SHALL present no Talk records and a visible message that identifies the selected Event_Type_Tag and states that no matching talks are available.
8. WHEN the Talks_Page completes its initial load, THE Talk_Filter SHALL select the "All talks" option.
9. WHILE any Talk_Filter option is selected, THE Talk_Filter SHALL expose exactly that option as selected to assistive technologies.

### Requirement 5: Provide optional embedded videos

**User Story:** As a Visitor, I want to watch available talk recordings on the Talks_Page, so that I can view a presentation without leaving the talk archive.

#### Acceptance Criteria

1. WHERE a Published_Talk contains a Video_URL, THE Talks_Section SHALL present exactly one Embedded_Video within that Published_Talk entry.
2. WHERE a Published_Talk contains a Video_URL, THE Embedded_Video SHALL expose a player label whose text includes the Published_Talk title.
3. WHEN a Visitor activates playback for an Embedded_Video, THE Talks_Section SHALL start playback within the Published_Talk entry without navigating the Visitor away from the Talks_Page.
4. WHERE a Published_Talk omits a Video_URL, THE Talks_Section SHALL present all remaining talk metadata and the slide-deck action without presenting an Embedded_Video or an empty video-player region.
5. IF an Embedded_Video fails to load or start playback, THEN THE Talks_Section SHALL retain the Visitor on the Talks_Page and preserve access to all talk metadata and the PDF_Slide_Deck available for that Published_Talk.

### Requirement 6: Open author-managed PDF slide decks

**User Story:** As a Visitor, I want to open the slides for a talk with one activation, so that I can review the presentation material.

#### Acceptance Criteria

1. THE Author_Managed_Content_Workflow SHALL be the sole mechanism by which a PDF_Slide_Deck is added, replaced, or removed from a Talk_Record.
2. THE Talks_Section SHALL present exactly one slide-deck link for each Published_Talk.
3. THE Talks_Section SHALL include the associated Published_Talk title and the text "PDF slides" in the accessible label of each slide-deck link.
4. WHEN a Visitor activates a slide-deck link once, THE Site SHALL return the PDF_Slide_Deck associated with that Published_Talk without requiring another activation.
5. THE Site SHALL serve each PDF_Slide_Deck from an HTTPS URL whose domain is salih.dev.
6. IF a PDF_Slide_Deck does not open as a PDF document, contains no pages, or reports a malformed-document error during publication validation, THEN THE Build_Validation SHALL reject the public Site build and provide a field-specific error indicating that PDF validation failed.
7. IF a Talk_Record has no associated PDF_Slide_Deck or has more than one associated PDF_Slide_Deck during publication validation, THEN THE Build_Validation SHALL reject the public Site build and provide a field-specific error indicating the required association count.

### Requirement 7: Preserve accessible and responsive interaction

**User Story:** As a Visitor using different devices or assistive technologies, I want the Talks section to remain operable and understandable, so that I can access talk content without an input-method or viewport barrier.

#### Acceptance Criteria

1. THE Talks_Section SHALL represent the Talks_Page heading and each Published_Talk title as HTML headings, each Talk_Filter option and Embedded_Video control as an HTML control with an accessible name, each Conference_Website_URL and slide-deck link as an HTML link with an accessible name, and each Published_Talk metadata item as programmatically determinable text associated with its Published_Talk.
2. WHEN a Visitor navigates the Talks_Section using only a keyboard, THE Talks_Section SHALL allow the Visitor to move focus to every Talk_Filter option, Conference_Website_URL, slide-deck link, and Embedded_Video control using Tab and Shift+Tab, activate each link using Enter, and activate each filter option or video control using Enter or Space without requiring pointer input.
3. WHILE an interactive Talks_Section control has keyboard focus, THE Site SHALL display a focus indicator that encloses the control, is at least 2 CSS pixels thick, and has a contrast ratio of at least 3:1 against the adjacent unfocused colors.
4. WHILE the viewport width is between 320 and 2560 CSS pixels inclusive, THE Talks_Page SHALL present all talk text, links, filters, and Embedded_Video controls without horizontal page scrolling, clipped content, or overlap that obscures content or prevents control activation.
5. IF video playback is unavailable, THEN THE Talks_Section SHALL preserve the associated Published_Talk title and metadata and keep its Conference_Website_URL and PDF_Slide_Deck keyboard-focusable and activatable.

### Requirement 8: Preserve machine-readable access and discovery

**User Story:** As an automated client, I want the Talks section represented through the Site's established discovery formats, so that I can locate and interpret public talk content.

#### Acceptance Criteria

1. THE Site SHALL make a Machine_Readable_Representation of the Talks_Page discoverable and retrievable through the same Markdown alternate mechanism used by the Site's other public pages.
2. THE Machine_Readable_Representation SHALL include the title, conference or event name, Talk_Date, Talk_Location, Conference_Website_URL, all Event_Type_Tag values, and PDF_Slide_Deck link associated with each Published_Talk, without including any unpublished Talk_Record.
3. WHERE a Published_Talk contains a Video_URL, THE Machine_Readable_Representation SHALL include that Video_URL in the content for the same Published_Talk.
4. THE Discovery_Documents SHALL each include the canonical Talks_Page URL exactly once and SHALL not identify a non-canonical Talks_Page URL as canonical.
5. WHEN the Author changes a Talk_Record and the next Site generation completes successfully, THE Site SHALL generate both the Talks_Page and its Machine_Readable_Representation from the same validated version of that Talk_Record.
6. IF a changed Talk_Record fails validation, THEN THE Site SHALL fail the Site generation, provide the Author with an error identifying the invalid Talk_Record and failed validation constraint, and publish neither output derived from the invalid Talk_Record.
7. IF no Published_Talk exists, THEN THE Site SHALL provide a retrievable Machine_Readable_Representation of the Talks_Page containing no talk entries.
