// clip_image.js
import { pipeline } from '@xenova/transformers';
import fs from 'fs/promises';
import path from 'path';

const run = async () => {
  console.log('Loading CLIP vision model...');
  
  // Use the vision feature extraction pipeline specifically
  const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', {
    local_files_only: false,
  });

  // Load local image - pass the path directly instead of reading the file
  const imagePath = path.resolve('./photos/car1.jpeg');
  
  console.log('Encoding image...');
  // Pass the image path directly to the model
  const embeddings = await extractor(imagePath, {
    pooling: 'mean',
    normalize: true,
  });

  // Save to JSON
  const outputPath = './embedding.json';
  await fs.writeFile(outputPath, JSON.stringify(Array.from(embeddings.data), null, 2));

  console.log(`✅ Saved embedding vector to ${outputPath}`);
};

run().catch(error => {
  console.error('Error:', error);
});
