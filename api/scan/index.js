/**
 * POST /scan Lambda Handler
 * Creates a scan job, enumerates S3 objects, and enqueues them for processing
 */

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageBatchCommand } = require('@aws-sdk/client-sqs');
const { getPool } = require('./shared/db');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL;

/**
 * List all objects in S3 bucket with optional prefix
 * @param {string} bucket - S3 bucket name
 * @param {string} prefix - Optional prefix
 * @returns {Array} - Array of S3 objects
 */
async function listS3Objects(bucket, prefix = '') {
  const objects = [];
  let continuationToken = null;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      objects.push(...response.Contents.filter(obj => obj.Size > 0)); // Filter out empty objects
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return objects;
}

/**
 * Send messages to SQS in batches
 * @param {string} jobId - Job ID
 * @param {string} bucket - Bucket name
 * @param {Array} objects - Array of S3 objects
 * @returns {number} - Number of messages sent
 */
async function enqueueObjects(jobId, bucket, objects) {
  const batchSize = 10; // SQS max batch size
  let sentCount = 0;
  
  for (let i = 0; i < objects.length; i += batchSize) {
    const batch = objects.slice(i, i + batchSize);
    
    const entries = batch.map((obj, index) => ({
      Id: `${i + index}`,
      MessageBody: JSON.stringify({
        job_id: jobId,
        bucket: bucket,
        key: obj.Key,
        etag: obj.ETag?.replace(/"/g, '')
      })
    }));
    
    try {
      const command = new SendMessageBatchCommand({
        QueueUrl: QUEUE_URL,
        Entries: entries
      });
      
      const response = await sqsClient.send(command);
      sentCount += (response.Successful?.length || 0);
      
      if (response.Failed && response.Failed.length > 0) {
        console.error('Failed to send some messages:', response.Failed);
      }
    } catch (error) {
      console.error('Error sending batch to SQS:', error);
      throw error;
    }
  }
  
  return sentCount;
}

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event));
  
  try {
    // Parse request body
    let body;
    if (typeof event.body === 'string') {
      body = JSON.parse(event.body);
    } else {
      body = event.body || {};
    }
    
    const { bucket, prefix } = body;
    
    // Validate input
    if (!bucket) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: bucket' })
      };
    }
    
    // Generate job ID
    const jobId = uuidv4();
    const now = new Date().toISOString();
    
    console.log(`Creating scan job ${jobId} for bucket: ${bucket}, prefix: ${prefix || '(none)'}`);
    
    // Insert job record
    const pool = await getPool();
    await pool.query(
      'INSERT INTO jobs (job_id, bucket, prefix, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [jobId, bucket, prefix || null, now, now]
    );
    
    // List S3 objects
    console.log('Listing S3 objects...');
    const objects = await listS3Objects(bucket, prefix || '');
    console.log(`Found ${objects.length} objects`);
    
    if (objects.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          message: 'No objects found to scan',
          object_count: 0
        })
      };
    }
    
    // Insert job_objects records
    console.log('Inserting job_objects records...');
    for (const obj of objects) {
      await pool.query(
        `INSERT INTO job_objects (job_id, bucket, key, etag, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (job_id, bucket, key, etag) DO NOTHING`,
        [jobId, bucket, obj.Key, obj.ETag?.replace(/"/g, ''), 'queued', now]
      );
    }
    
    // Enqueue messages to SQS
    console.log('Enqueueing messages to SQS...');
    const sentCount = await enqueueObjects(jobId, bucket, objects);
    console.log(`Enqueued ${sentCount} messages`);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        message: 'Scan initiated successfully',
        object_count: objects.length,
        enqueued_count: sentCount
      })
    };
    
  } catch (error) {
    console.error('Error processing scan request:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

