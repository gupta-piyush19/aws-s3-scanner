/**
 * S3 file handling operations
 */

const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.txt', '.csv', '.json', '.log'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB limit for processing

/**
 * Check if file type is supported
 * @param {string} key - S3 object key
 * @returns {boolean} - True if supported
 */
function isSupportedFileType(key) {
  const extension = key.slice(key.lastIndexOf('.')).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(extension);
}

/**
 * Download and read S3 object content
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<{content: string, etag: string}>} - File content and ETag
 */
async function downloadS3Object(bucket, key) {
  try {
    // First, check file size
    const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const headResponse = await s3Client.send(headCommand);
    
    const contentLength = headResponse.ContentLength;
    if (contentLength > MAX_FILE_SIZE) {
      throw new Error(`File size (${contentLength} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes)`);
    }
    
    // Download the object
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(getCommand);
    
    // Convert stream to string
    const content = await streamToString(response.Body);
    
    return {
      content,
      etag: response.ETag?.replace(/"/g, '') || headResponse.ETag?.replace(/"/g, ''),
      contentType: response.ContentType,
      contentLength: contentLength
    };
  } catch (error) {
    console.error(`Error downloading S3 object s3://${bucket}/${key}:`, error.message);
    throw error;
  }
}

/**
 * Convert readable stream to string
 * @param {ReadableStream} stream - Readable stream
 * @returns {Promise<string>} - String content
 */
async function streamToString(stream) {
  const chunks = [];
  
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/**
 * Get file metadata without downloading content
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<object>} - File metadata
 */
async function getS3ObjectMetadata(bucket, key) {
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);
    
    return {
      etag: response.ETag?.replace(/"/g, ''),
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified
    };
  } catch (error) {
    console.error(`Error getting S3 object metadata s3://${bucket}/${key}:`, error.message);
    throw error;
  }
}

module.exports = {
  downloadS3Object,
  getS3ObjectMetadata,
  isSupportedFileType,
  SUPPORTED_EXTENSIONS,
  MAX_FILE_SIZE
};

