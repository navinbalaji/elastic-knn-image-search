import express from "express";
import { Client } from "@elastic/elasticsearch";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3000;
const INDEX_NAME = process.env.ELASTIC_INDEX;
const PHOTOS_DIR = path.resolve(process.env.IMAGE_DIRECTORY || "./photos");
const MAX_SELECTION = 5;
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

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

// List all images in the photos directory
app.get("/api/photos", async (req, res) => {
  try {
    const files = await fs.readdir(PHOTOS_DIR);
    const images = files
      .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .sort();
    res.json(images);
  } catch (err) {
    console.error("Failed to list photos:", err.message);
    res.status(500).json({ error: "Failed to list photos directory" });
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
      _source: ["filename", "uploaded_at"],
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
