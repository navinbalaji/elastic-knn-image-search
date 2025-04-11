import { Client } from "@elastic/elasticsearch";
import { pipeline } from "@xenova/transformers";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

// Elasticsearch configuration
const client = new Client({
  node: process.env.ELASTIC_NODE,
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD,
  },
});

const INDEX_NAME = process.env.ELASTIC_INDEX;
// CLIP ViT base patch32
const DIMENSIONS = parseInt(process.env.ELASTIC_DIMESION);

// Create index with dense_vector if it doesn't exist
const createIndexIfNeeded = async () => {
  const exists = await client.indices.exists({ index: INDEX_NAME });
  if (!exists) {
    console.log("Index not found. Creating index...");
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
            uploaded_at: { type: "date" },
          },
        },
      },
    });
    console.log("✅ Index created");
  } else {
    console.log("✅ Index already exists");
  }
};

// Generate embedding vector from image
const extractEmbedding = async (imagePath) => {
  try {
    await fs.access(imagePath);
  } catch (err) {
    console.error("❌ Image does not exist.");
    process.exit(1);
  }
  console.log("Loading CLIP model...");
  const extractor = await pipeline("image-feature-extraction", "Xenova/clip-vit-base-patch32");
  console.log("Generating embedding...");
  const embeddings = await extractor(imagePath, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(embeddings.data);
};

// Upload image and index vector
const uploadImage = async (imagePath) => {
  const filename = path.basename(imagePath);
  const vector = await extractEmbedding(imagePath);

  await createIndexIfNeeded();

  const res = await client.index({
    index: INDEX_NAME,
    document: {
      image_vector: vector,
      filename,
      uploaded_at: new Date(),
    },
  });

  console.log(`✅ Image '${filename}' indexed with ID: ${res._id}`);
};

// Search similar images using query image
const searchImage = async (imagePath) => {
  const vector = await extractEmbedding(imagePath);

  console.log("Searching similar images...");
  const response = await client.search({
    index: INDEX_NAME,
    knn: {
      field: "image_vector",
      query_vector: vector,
      k: 5,
      num_candidates: 50,
    },
    _source: ["filename", "uploaded_at"],
  });

  const hits = response.hits.hits;
  if (hits.length === 0) {
    console.log("❌ No similar images found.");
    return;
  }

  console.log("🎯 Top matches:");
  await Promise.all(
    hits.map(async (hit, i) => {
      const { filename, uploaded_at } = hit._source;
      console.log(`${i + 1}. ${filename} (score: ${hit._score.toFixed(4)}) - uploaded at ${uploaded_at}`);
    })
  );

  const result = hits.map((hit, i) => ({
    rank: i + 1,
    filename: hit._source.filename,
    score: hit._score.toFixed(4),
    uploaded_at: hit._source.uploaded_at,
  }));

  const outputPath = path.resolve("search_results.json");
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`✅ Search results saved to ${outputPath}`);

  const searchImageOutputPath = path.resolve("search_image.json");
  const searchImageData = {
    search_image: path.basename(imagePath),
  };
  await fs.writeFile(searchImageOutputPath, JSON.stringify(searchImageData, null, 2));
  console.log(`✅ Search image details saved to ${searchImageOutputPath}`);
};

// Delete all images from index
const deleteAllImages = async () => {
  await client.deleteByQuery({
    index: INDEX_NAME,
    body: {
      query: {
        match_all: {},
      },
    },
  });

  await client.indices.delete({
    index: INDEX_NAME,
  });
  console.log("✅ All documents deleted");
};

// Upload all images in a directory
const uploadAllImages = async () => {
  const imagesDir = path.resolve(process.env.IMAGE_DIRECTORY);
  const files = await fs.readdir(imagesDir);
  const imageFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(ext);
  });
  for (const file of imageFiles) {
    const imagePath = path.join(imagesDir, file);
    await uploadImage(imagePath);
  }
  console.log("✅ All images uploaded");
  return;
};

// Entry point
const run = async () => {
  const args = process.argv.slice(2);
  const mode = args[0];
  const imagePath = args[1];

  if (!mode) {
    console.error("Usage:");
    console.error("  node image_vector_tool.js --upload <image_path>");
    console.error("  node image_vector_tool.js --search <image_path>");
    console.error("  node image_vector_tool.js --delete");
    console.error("  node image_vector_tool.js --upload-all");
    return;
  }

  let resolvedPath = "";
  if (imagePath) {
    resolvedPath = path.resolve(imagePath);
  }

  if (mode === "--upload" && resolvedPath) {
    await uploadImage(resolvedPath);
  } else if (mode === "--search" && resolvedPath) {
    await searchImage(resolvedPath);
  } else if (mode === "--delete") {
    await deleteAllImages();
  } else if (mode === "--upload-all") {
    await uploadAllImages();
  } else {
    console.error("❌ Unknown mode. Use --upload or --search.");
  }
};

run().catch(console.error);
