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

## 5. Search

```bash
node elastic.js --search photos/<image>.jpg
```

Prints the top-8 matches and writes `search_results.json` + `search_image.json`.

## 6. View results in the browser

The results page fetches JSON files, so it must be served over HTTP (not opened via `file://`):

```bash
npx serve .
```

Open http://localhost:3000/output.html.

> Fix applied: `getImagePath()` in `output.html` was hardcoded to `./testdata/Test/` — it now resolves images from `./photos/`.

## CLI reference

| Command | Description |
|---|---|
| `node elastic.js --upload <path>` | Index a single image |
| `node elastic.js --upload-all` | Index all images in `IMAGE_DIRECTORY` |
| `node elastic.js --search <path>` | Find similar images |
| `node elastic.js --delete` | Delete the index and all documents |

## Troubleshooting

- **`Unsupported pipeline: image-feature-extraction`** — stale install; run `npm install` (needs `@xenova/transformers` 2.17.2+)
- **Connection refused on 9200** — ES container not running: `docker start es-knn`
- **Broken thumbnails in output.html** — page opened via `file://` or images not in `photos/`; serve with `npx serve .`
- **Searching an indexed image returns itself at ~1.0** — expected; test with an image not in the index for a more meaningful demo
