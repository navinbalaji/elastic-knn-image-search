# Setup Guide — Elastic KNN Image Search

Semantic image search using CLIP embeddings (512-dim) stored in Elasticsearch and queried with kNN cosine similarity.

## Prerequisites

- Node.js v14+
- Docker Desktop (or OrbStack/colima)

## 1. Install

```bash
git clone https://github.com/YoelL/elastic-semantic-image-search
cd elastic-knn-image-search
npm install
```

> `@xenova/transformers` must be 2.17.2+ (the lockfile pins it). Older versions (2.0.x) lack the `image-feature-extraction` pipeline and `elastic.js` fails with `Unsupported pipeline: image-feature-extraction`.

## 2. Start Elasticsearch (local Docker)

```bash
docker run -d --name es-knn -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS="-Xms1g -Xmx1g" \
  docker.elastic.co/elasticsearch/elasticsearch:8.17.1
```

Verify (takes ~20–30s to boot):

```bash
curl http://localhost:9200
```

Security is disabled for local dev, so credentials in `.env` are placeholders. To restart later: `docker start es-knn`.

## 3. Configure `.env`

Create `.env` in the project root:

```
ELASTIC_NODE=http://localhost:9200
ELASTIC_USERNAME=elastic
ELASTIC_PASSWORD=changeme
ELASTIC_INDEX=image-search
ELASTIC_DIMESION=512
IMAGE_DIRECTORY=./photos
```

Note: `ELASTIC_DIMESION` (typo) is the actual variable name the code reads.

## 4. Index images

Put `.jpg`/`.png`/`.webp` images in `photos/`, then:

```bash
node elastic.js --upload-all
```

First run downloads the CLIP model (~350MB). The index (`image-search`, `dense_vector` with cosine similarity) is created automatically.

## 5. Search in the browser (interactive UI)

```bash
node server.js
```

Open http://localhost:3000/search (also served at `/`):

1. The page shows a grid of all images in `photos/`
2. Click to select up to 5 images
3. Press **Search for match** — results appear in the Similar Images section

With multiple images selected, their stored embeddings are averaged (L2-normalized) into a single kNN query. Selected images are excluded from results. Images must be indexed first (step 4) — the search uses vectors stored in ES, not live CLIP inference.

## 6. Search from the CLI (alternative)

```bash
node elastic.js --search photos/<image>.jpg
```

Prints the top-8 matches and writes `search_results.json` + `search_image.json`. Works with images that aren't indexed (runs CLIP locally on the query image). View the results at http://localhost:3000/output.

## API reference

Base URL: `http://localhost:3000`

### `POST /api/images` — batch ingest for a profile

Embeds a batch of images (local paths or URLs, e.g. S3 presigned URLs) and indexes them in ES linked to a profile UUID.

```bash
curl -X POST http://localhost:3000/api/images \
  -H 'Content-Type: application/json' \
  -d '{
    "profile_id": "5f0e8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b",
    "images": [
      "photos/car1.jpeg",
      "https://bucket.s3.amazonaws.com/key.png?X-Amz-Signature=...",
      { "id": "9b2f8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b", "source": "photos/car2.jpeg" }
    ]
  }'
```

Response (`200` all indexed, `207` partial failure):

```json
{ "profile_id": "...", "indexed": 2, "failed": 1, "results": [ { "id": "...", "source": "...", "status": "indexed" } ] }
```

- Each image may be a plain string or `{ id, source }` — `id` (UUID) becomes the ES doc `_id` (idempotent re-ingest); generated if omitted
- Max 100 images per batch (override with `MAX_BATCH_SIZE` in `.env`); processed sequentially (~0.1–1s per image), so very large batches mean long-running requests — chunk client-side if you need thousands
- First ingest after server start loads the CLIP model (~1–2s warm, ~350MB download on first ever run)

### `POST /api/search` — find similar images

1–5 filenames of already-indexed images; embeddings are averaged into one query. Returns top-8 matches with `profile_id` per hit (null for pre-profile images).

```bash
curl -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{ "filenames": ["car1.jpeg", "car2.jpeg"] }'
```

Response:

```json
{ "results": [ { "rank": 1, "filename": "...", "score": "0.9532", "uploaded_at": "...", "profile_id": "..." } ], "missing": [] }
```

### `GET /api/profiles/:profile_id/images` — list a profile's images

```bash
curl http://localhost:3000/api/profiles/5f0e8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b/images
```

Response (newest first):

```json
{ "profile_id": "...", "count": 2, "images": [ { "id": "<image-uuid>", "filename": "...", "source": "...", "uploaded_at": "..." } ] }
```

### `PATCH /api/profiles/:profile_id` — reassign a profile's images

Points every image of `:profile_id` at a new profile UUID. `404` if the old profile has no images.

```bash
curl -X PATCH http://localhost:3000/api/profiles/5f0e8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b \
  -H 'Content-Type: application/json' \
  -d '{ "new_profile_id": "aa0e8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b" }'
```

Response:

```json
{ "old_profile_id": "...", "new_profile_id": "...", "updated": 12 }
```

### `POST /api/images/profile-lookup` — resolve image IDs to profiles

Returns the owning profile UUIDs, deduplicated, plus any IDs not found.

```bash
curl -X POST http://localhost:3000/api/images/profile-lookup \
  -H 'Content-Type: application/json' \
  -d '{ "image_ids": ["9b2f8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b", "7c1e8a1c-2b3d-4e5f-8a9b-0c1d2e3f4a5b"] }'
```

Response:

```json
{ "profile_ids": ["<profile-uuid>"], "missing": ["<image-uuid>"] }
```

### `DELETE /api/images` — delete all indexed documents

Clears every document but keeps the index + mapping (unlike `node elastic.js --delete`, which drops the index).

```bash
curl -X DELETE http://localhost:3000/api/images
```

Response:

```json
{ "deleted": 72 }
```

### `GET /api/photos` — list the local photos directory

Each file is flagged with whether it's currently indexed in ES.

```bash
curl http://localhost:3000/api/photos
```

Response:

```json
[ { "filename": "car1.jpeg", "indexed": true } ]
```

## CLI reference

| Command | Description |
|---|---|
| `node server.js` | Start the web UI (http://localhost:3000/search) |
| `node elastic.js --upload <path>` | Index a single image |
| `node elastic.js --upload-all` | Index all images in `IMAGE_DIRECTORY` |
| `node elastic.js --search <path>` | Find similar images |
| `node elastic.js --delete` | Delete the index and all documents |

## Troubleshooting

- **`Unsupported pipeline: image-feature-extraction`** — stale install; run `npm install` (needs `@xenova/transformers` 2.17.2+)
- **Connection refused on 9200** — ES container not running: `docker start es-knn`
- **Broken thumbnails in output.html** — page opened via `file://` or images not in `photos/`; serve with `node server.js`
- **"None of the selected images are indexed"** — run `node elastic.js --upload-all` first; the UI searches with stored vectors
- **Searching an indexed image returns itself at ~1.0** — expected; test with an image not in the index for a more meaningful demo
