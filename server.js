import express from "express";
import { Client } from "@elastic/elasticsearch";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;
const INDEX_NAME = process.env.ELASTIC_INDEX;
const DIMENSIONS = parseInt(process.env.ELASTIC_DIMESION) || 512;
const PHOTOS_DIR = path.resolve(process.env.IMAGE_DIRECTORY || "./photos");
const MAX_SELECTION = 5;
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE) || 100;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const client = new Client({
  node: process.env.ELASTIC_NODE,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

const app = express();
app.use(express.json());
app.use(express.static("."));

// /search (and /) → interactive selection UI; /output → CLI search results viewer
app.get(["/", "/search"], (req, res) => {
  res.sendFile(path.resolve("search.html"));
});
app.get("/output", (req, res) => {
  res.sendFile(path.resolve("output.html"));
});

// Fetch the set of filenames currently indexed in Elasticsearch
const getIndexedFilenames = async () => {
  try {
    const response = await client.search({
      index: INDEX_NAME,
      size: 10000,
      query: { match_all: {} },
      _source: ["filename"],
    });
    return new Set(response.hits.hits.map((h) => h._source.filename));
  } catch {
    // Index missing (e.g. after --delete) or ES down → nothing is indexed
    return new Set();
  }
};

// List all images in the photos directory, flagged with their index status
app.get("/api/photos", async (req, res) => {
  try {
    const files = await fs.readdir(PHOTOS_DIR);
    const indexed = await getIndexedFilenames();
    const images = files
      .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort()
      .map((filename) => ({ filename, indexed: indexed.has(filename) }));
    res.json(images);
  } catch (err) {
    console.error("Failed to list photos:", err.message);
    res.status(500).json({ error: "Failed to list photos directory" });
  }
});

// --- CLIP embedding (model loaded once, lazily) ---
let extractorPromise = null;
const getExtractor = () => {
  if (!extractorPromise) {
    console.log("Loading CLIP model (first request only)...");
    // Dynamic import: server starts without the ML dependency; loaded on first ingest
    extractorPromise = import("@xenova/transformers").then(({ pipeline }) =>
      pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32")
    );
  }
  return extractorPromise;
};

// source can be a local path or an http(s) URL (e.g. S3 presigned URL)
const embedImage = async (source) => {
  const extractor = await getExtractor();
  const embeddings = await extractor(source, { pooling: "mean", normalize: true });
  return Array.from(embeddings.data);
};

// Derive a clean filename from a path or URL (strips query string)
const filenameFromSource = (source) => {
  try {
    return path.basename(new URL(source).pathname);
  } catch {
    return path.basename(source);
  }
};

// --- Index management ---
const ensureIndex = async () => {
  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (!exists) {
    await client.indices.create({
      index: INDEX_NAME,
      body: {
        mappings: {
          properties: {
            image_vector: {
              type: "dense_vector",
              dims: DIMENSIONS,
              index: true,
              similarity: "cosine",
            },
            filename: { type: "keyword" },
            profile_id: { type: "keyword" },
            source: { type: "keyword" },
            uploaded_at: { type: "date" },
          },
        },
      },
    });
    console.log("✅ Index created");
  } else {
    // Additive mapping update — safe on an existing index
    await client.indices.putMapping({
      index: INDEX_NAME,
      properties: {
        profile_id: { type: "keyword" },
        source: { type: "keyword" },
      },
    });
  }
};

// Ingest a batch of images for a profile
// Body: { profile_id: "<uuid>", images: ["<path-or-url>", ...] }
//   or  { profile_id: "<uuid>", images: [{ id: "<uuid>", source: "<path-or-url>" }, ...] }
app.post("/api/images", async (req, res) => {
  const { profile_id, images } = req.body;

  if (!profile_id || !UUID_RE.test(profile_id)) {
    return res.status(400).json({ error: "profile_id must be a valid UUID" });
  }
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "images must be a non-empty array" });
  }
  if (images.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ error: `Batch too large (max ${MAX_BATCH_SIZE})` });
  }

  // Normalize items to { id, source }
  const items = [];
  for (const item of images) {
    const source = typeof item === "string" ? item : item?.source;
    const id = typeof item === "object" && item?.id ? item.id : randomUUID();
    if (!source || typeof source !== "string") {
      return res.status(400).json({ error: "Each image needs a source (path or URL)" });
    }
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ error: `Invalid image id: ${id} (must be a UUID)` });
    }
    items.push({ id, source });
  }

  try {
    await ensureIndex();
  } catch (err) {
    console.error("Index setup failed:", err.message);
    return res.status(500).json({ error: "Elasticsearch unavailable" });
  }

  const results = [];
  for (const { id, source } of items) {
    try {
      const vector = await embedImage(source);
      await client.index({
        index: INDEX_NAME,
        id, // image UUID as doc _id → idempotent re-ingestion
        document: {
          image_vector: vector,
          filename: filenameFromSource(source),
          profile_id,
          source,
          uploaded_at: new Date(),
        },
      });
      results.push({ id, source, status: "indexed" });
    } catch (err) {
      console.error(`Failed to ingest ${source}:`, err.message);
      results.push({ id, source, status: "failed", error: err.message });
    }
  }

  const indexed = results.filter((r) => r.status === "indexed").length;
  res.status(results.length === indexed ? 200 : 207).json({
    profile_id,
    indexed,
    failed: results.length - indexed,
    results,
  });
});

// Delete all indexed documents (keeps the index + mapping)
app.delete("/api/images", async (req, res) => {
  try {
    const exists = await client.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      return res.json({ deleted: 0 });
    }
    const response = await client.deleteByQuery({
      index: INDEX_NAME,
      query: { match_all: {} },
      refresh: true,
    });
    res.json({ deleted: response.deleted });
  } catch (err) {
    console.error("Delete all failed:", err.message);
    res.status(500).json({ error: "Delete failed. Is Elasticsearch running?" });
  }
});

// List all images attached to a profile
app.get("/api/profiles/:profile_id/images", async (req, res) => {
  const { profile_id } = req.params;
  if (!UUID_RE.test(profile_id)) {
    return res.status(400).json({ error: "profile_id must be a valid UUID" });
  }

  try {
    const response = await client.search({
      index: INDEX_NAME,
      size: 10000,
      query: { term: { profile_id } },
      _source: ["filename", "source", "uploaded_at"],
      sort: [{ uploaded_at: "desc" }],
    });

    const images = response.hits.hits.map((hit) => ({
      id: hit._id,
      filename: hit._source.filename,
      source: hit._source.source ?? null,
      uploaded_at: hit._source.uploaded_at,
    }));

    res.json({ profile_id, count: images.length, images });
  } catch (err) {
    console.error("Profile images lookup failed:", err.message);
    res.status(500).json({ error: "Lookup failed. Is Elasticsearch running?" });
  }
});

// Reassign all of a profile's images to a new profile UUID
// Body: { new_profile_id: "<uuid>" }
app.patch("/api/profiles/:profile_id", async (req, res) => {
  const { profile_id } = req.params;
  const { new_profile_id } = req.body;

  if (!UUID_RE.test(profile_id)) {
    return res.status(400).json({ error: "profile_id must be a valid UUID" });
  }
  if (!new_profile_id || !UUID_RE.test(new_profile_id)) {
    return res.status(400).json({ error: "new_profile_id must be a valid UUID" });
  }
  if (profile_id === new_profile_id) {
    return res.status(400).json({ error: "new_profile_id must differ from the current one" });
  }

  try {
    const response = await client.updateByQuery({
      index: INDEX_NAME,
      query: { term: { profile_id } },
      script: {
        source: "ctx._source.profile_id = params.newId",
        params: { newId: new_profile_id },
      },
      refresh: true,
      conflicts: "abort",
    });

    if (response.updated === 0) {
      return res.status(404).json({ error: `No images found for profile ${profile_id}` });
    }
    res.json({ old_profile_id: profile_id, new_profile_id, updated: response.updated });
  } catch (err) {
    console.error("Profile reassignment failed:", err.message);
    res.status(500).json({ error: "Update failed. Is Elasticsearch running?" });
  }
});

// Resolve image IDs → unique profile UUIDs
// Body: { image_ids: ["<uuid>", ...] }
app.post("/api/images/profile-lookup", async (req, res) => {
  const { image_ids } = req.body;

  if (!Array.isArray(image_ids) || image_ids.length === 0) {
    return res.status(400).json({ error: "image_ids must be a non-empty array" });
  }
  const invalid = image_ids.filter((id) => typeof id !== "string" || !UUID_RE.test(id));
  if (invalid.length > 0) {
    return res.status(400).json({ error: "Invalid image ids (must be UUIDs)", invalid });
  }

  try {
    const response = await client.mget({
      index: INDEX_NAME,
      ids: [...new Set(image_ids)],
      _source: ["profile_id"],
    });

    const profileIds = new Set();
    const missing = [];
    for (const doc of response.docs) {
      if (doc.found && doc._source.profile_id) profileIds.add(doc._source.profile_id);
      else if (!doc.found) missing.push(doc._id);
    }

    res.json({ profile_ids: [...profileIds], missing });
  } catch (err) {
    console.error("Profile lookup failed:", err.message);
    res.status(500).json({ error: "Lookup failed. Is Elasticsearch running?" });
  }
});

// Fetch the stored embedding for a filename from Elasticsearch
const getStoredVector = async (filename) => {
  const response = await client.search({
    index: INDEX_NAME,
    size: 1,
    query: { term: { filename } },
    _source: ["image_vector"],
  });
  const hit = response.hits.hits[0];
  return hit ? hit._source.image_vector : null;
};

// Average multiple vectors into one normalized query vector
const averageVectors = (vectors) => {
  const dims = vectors[0].length;
  const mean = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dims; i++) mean[i] /= vectors.length;
  // L2-normalize (cosine similarity expects unit vectors from CLIP)
  const norm = Math.sqrt(mean.reduce((s, x) => s + x * x, 0));
  return mean.map((x) => x / norm);
};

// Search for images similar to the selected (already indexed) images
app.post("/api/search", async (req, res) => {
  const { filenames } = req.body;

  if (!Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: "filenames must be a non-empty array" });
  }
  if (filenames.length > MAX_SELECTION) {
    return res.status(400).json({ error: `Select at most ${MAX_SELECTION} images` });
  }

  try {
    const vectors = [];
    const missing = [];
    for (const filename of filenames) {
      const vector = await getStoredVector(filename);
      if (vector) vectors.push(vector);
      else missing.push(filename);
    }

    if (vectors.length === 0) {
      return res.status(404).json({
        error: "None of the selected images are indexed. Run: node elastic.js --upload-all",
        missing,
      });
    }

    const queryVector = vectors.length === 1 ? vectors[0] : averageVectors(vectors);

    const response = await client.search({
      index: INDEX_NAME,
      knn: {
        field: "image_vector",
        query_vector: queryVector,
        k: 16 + filenames.length, // headroom for excluded query images + potential duplicate docs
        num_candidates: 100,
      },
      _source: ["filename", "uploaded_at", "profile_id"],
    });

    // Exclude query images and dedupe by filename (keeps best-scoring doc)
    const seen = new Set();
    const results = response.hits.hits
      .filter((hit) => {
        const { filename } = hit._source;
        if (filenames.includes(filename) || seen.has(filename)) return false;
        seen.add(filename);
        return true;
      })
      .slice(0, 8)
      .map((hit, i) => ({
        rank: i + 1,
        filename: hit._source.filename,
        score: hit._score.toFixed(4),
        uploaded_at: hit._source.uploaded_at,
        profile_id: hit._source.profile_id ?? null,
      }));

    res.json({ results, missing });
  } catch (err) {
    console.error("Search failed:", err.message);
    res.status(500).json({ error: "Search failed. Is Elasticsearch running?" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}/search`);
});
