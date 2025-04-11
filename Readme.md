# Install dependencies (if not already installed)
npm install @xenova/transformers @elastic/elasticsearch

# Upload an image
node elastic.js --upload ./photos/apple.webp

# Search with a query image
node elastic.js --search ./photos/query.webp
