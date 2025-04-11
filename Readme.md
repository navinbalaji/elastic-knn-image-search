# Image Search Application

A web application that allows users to upload images and search for similar images using Elasticsearch and CLIP embeddings.

## Features

- Upload images to the database
- Search for similar images using a query image
- View search results with similarity scores
- Modern and responsive UI

## Prerequisites

- Node.js (v14 or higher)
- Elasticsearch instance (v8.x)
- CLIP model for image embeddings

## Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd image-search
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
   PORT=3000
   ```

4. Start the server:
   ```
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. **Upload an Image**:
   - Click on the "Choose File" button in the Upload Image section
   - Select an image file
   - Click the "Upload" button
   - Wait for the upload to complete

2. **Search for Similar Images**:
   - Click on the "Choose File" button in the Search Similar Images section
   - Select an image file to use as a query
   - Click the "Search" button
   - View the results displayed in the Results section

## How It Works

1. When an image is uploaded, the application:
   - Saves the image to the server
   - Generates an embedding vector using the CLIP model
   - Stores the vector and image metadata in Elasticsearch

2. When searching for similar images, the application:
   - Generates an embedding vector for the query image
   - Searches Elasticsearch for images with similar vectors
   - Returns and displays the results

## Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **Database**: Elasticsearch
- **Image Processing**: CLIP (Contrastive Language-Image Pre-training)
- **File Upload**: Multer

## License

MIT
