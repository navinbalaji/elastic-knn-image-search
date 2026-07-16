# Image Ingestion Flow

Architecture: Vapor (users/profiles, Postgres) + Node search service (CLIP embeddings, Elasticsearch). Images upload directly to S3 via presigned URLs; embedding happens asynchronously after upload.

## Ingestion pipeline

```mermaid
flowchart TD
    A[Client requests upload slots<br/><small>asks for N images</small>]
    B[Vapor creates image rows<br/><small>UUIDs + presigned URLs returned</small>]
    C[Client uploads straight to S3<br/><small>bytes never touch Vapor</small>]
    D[Vapor queues embed job<br/><small>triggered by S3 event</small>]
    E[Node service embeds batch<br/><small>fetch from S3, validate, CLIP</small>]
    F[Index into Elasticsearch<br/><small>doc _id = image UUID</small>]
    G[Image searchable<br/><small>linked to profile via UUID</small>]
    X[Failed<br/><small>bad file or error</small>]

    A --> B --> C --> D --> E --> F --> G
    E -- validation/embed error --> X
    X -. retry (max 3) .-> E
```

## `profile_images.status` lifecycle

```mermaid
stateDiagram-v2
    [*] --> awaiting_upload : rows created, presigned URLs issued
    awaiting_upload --> pending_embedding : S3 event confirms upload
    awaiting_upload --> swept : never uploaded, cleaned up after timeout
    pending_embedding --> indexed : embedded + indexed in ES
    pending_embedding --> failed : bad file or embed error
    failed --> pending_embedding : retry (capped, e.g. 3 attempts)
    failed --> [*] : terminal after max retries, surfaced to user
    indexed --> [*] : user deletes image (remove Postgres row AND ES doc)
    swept --> [*]
```

## Notes

- **Postgres owns identity.** `profile_images.id` (UUID) is the canonical key; the ES document uses it as `_id`, making indexing idempotent. ES docs carry `profile_id` (denormalized) so search returns profile references without a round-trip.
- **ES is disposable.** Never store anything in ES that can't be rebuilt from Postgres + S3.
- **Deletes propagate.** Removing an image deletes both the Postgres row and the ES doc. A periodic reconciliation job compares `indexed` rows against ES doc IDs to catch drift.
- **Validation happens in the embed job.** Presigned URLs constrain content-type and max size; real validation (corrupt/non-image files) happens when the Node service downloads the file.
- **Truth = S3 object existence.** Prefer S3 event notifications over client "done" confirmations.
