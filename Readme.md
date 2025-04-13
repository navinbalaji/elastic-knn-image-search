# Image Search Application

A web application that allows users to search for similar images using Elasticsearch and CLIP embeddings. This application uses the CLIP vision model to generate embeddings for images and Elasticsearch for efficient similarity search.

## Features

- Upload images to Elasticsearch with vector embeddings
- Search for similar images using a query image
- View search results with similarity scores in a modern UI
- Batch upload functionality for multiple images
- Command-line interface for easy operation

## Prerequisites

- Node.js (v14 or higher)
- Elasticsearch instance (v8.x)
- CLIP model for image embeddings

## Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd knn
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   ELASTIC_NODE=https://your-elasticsearch-node
   ELASTIC_USERNAME=your-username
   ELASTIC_PASSWORD=your-password
   ELASTIC_INDEX=image-search
   ELASTIC_DIMESION=512
   IMAGE_DIRECTORY=./photos
   ```

## Usage

The application provides a command-line interface for various operations:

### Upload a Single Image

```
node elastic.js --upload <image_path>
```

### Search for Similar Images

```
node elastic.js --search <image_path>
```

### Upload All Images in a Directory

```
node elastic.js --upload-all
```

### Delete All Images from the Index

```
node elastic.js --delete
```

### Generate Embeddings for an Image

```
node clip.js
```

## Viewing Results

After performing a search, the application generates two JSON files:
- `search_results.json`: Contains the search results with similarity scores
- `search_image.json`: Contains information about the query image

You can view the results in a web browser by opening the `index.html` file, which provides a modern and responsive UI for displaying the search results.

## How It Works

1. **Image Embedding Generation**:
   - The application uses the CLIP vision model to generate embeddings for images
   - The embeddings are 512-dimensional vectors that capture the visual features of the images

2. **Elasticsearch Integration**:
   - The embeddings are stored in Elasticsearch using the `dense_vector` field type
   - Elasticsearch's k-NN search capabilities are used to find similar images

3. **Similarity Search**:
   - When a query image is provided, its embedding is generated
   - Elasticsearch finds the k nearest neighbors based on cosine similarity
   - Results are returned with similarity scores and displayed in the UI

## Project Structure

- `elastic.js`: Main application file for Elasticsearch operations
- `clip.js`: Utility for generating embeddings using the CLIP model
- `index.html`: Web interface for displaying search results
- `photos/`: Directory for storing images
- `testdata/`: Directory for test images

## Technologies Used

- **Backend**: Node.js
- **Database**: Elasticsearch
- **Image Processing**: CLIP (Contrastive Language-Image Pre-training)
- **Frontend**: HTML, CSS, JavaScript
- **Libraries**: @elastic/elasticsearch, @xenova/transformers

## License

MIT
