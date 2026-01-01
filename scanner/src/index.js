/**
 * Scanner Worker - Main Entry Point
 * Polls SQS for scan jobs, downloads S3 files, detects sensitive data, and stores findings
 */

const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { downloadS3Object, isSupportedFileType } = require('./s3-handler');
const { scanContent } = require('./detectors');
const { initPool, updateJobObjectStatus, insertFindings, closePool } = require('./db');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const MAX_MESSAGES = 1; // Process one message at a time
const WAIT_TIME_SECONDS = 20; // Long polling
const VISIBILITY_TIMEOUT = 300; // 5 minutes

let isShuttingDown = false;

/**
 * Process a single SQS message
 * @param {object} message - SQS message
 */
async function processMessage(message) {
  const startTime = Date.now();
  let messageBody;
  
  try {
    messageBody = JSON.parse(message.Body);
    console.log(`Processing message: ${JSON.stringify(messageBody)}`);
  } catch (error) {
    console.error('Failed to parse message body:', error);
    // Delete malformed messages
    await deleteMessage(message.ReceiptHandle);
    return;
  }
  
  const { bucket, key, job_id, etag } = messageBody;
  
  if (!bucket || !key || !job_id) {
    console.error('Missing required fields in message:', messageBody);
    await deleteMessage(message.ReceiptHandle);
    return;
  }
  
  try {
    // Update status to processing
    await updateJobObjectStatus(job_id, bucket, key, etag, 'processing');
    
    // Check if file type is supported
    if (!isSupportedFileType(key)) {
      console.log(`Skipping unsupported file type: ${key}`);
      await updateJobObjectStatus(job_id, bucket, key, etag, 'succeeded', 'Unsupported file type - skipped');
      await deleteMessage(message.ReceiptHandle);
      return;
    }
    
    // Download file from S3
    console.log(`Downloading s3://${bucket}/${key}`);
    const { content, etag: actualEtag } = await downloadS3Object(bucket, key);
    
    // Use actual ETag from S3 if not provided in message
    const fileEtag = etag || actualEtag;
    
    console.log(`File downloaded: ${content.length} bytes`);
    
    // Scan content for sensitive data
    console.log('Scanning for sensitive data...');
    const findings = scanContent(content, bucket, key, fileEtag, job_id);
    
    console.log(`Found ${findings.length} potential sensitive data matches`);
    
    // Insert findings into database
    if (findings.length > 0) {
      const insertedCount = await insertFindings(findings);
      console.log(`Inserted ${insertedCount} new findings (${findings.length - insertedCount} duplicates skipped)`);
    }
    
    // Update status to succeeded
    await updateJobObjectStatus(job_id, bucket, key, fileEtag, 'succeeded');
    
    // Delete message from queue
    await deleteMessage(message.ReceiptHandle);
    
    const duration = Date.now() - startTime;
    console.log(`Successfully processed s3://${bucket}/${key} in ${duration}ms`);
    
  } catch (error) {
    console.error(`Error processing message:`, error);
    
    // Update status to failed
    const errorMessage = error.message || 'Unknown error';
    try {
      await updateJobObjectStatus(job_id, bucket, key, etag, 'failed', errorMessage);
    } catch (dbError) {
      console.error('Failed to update error status in database:', dbError);
    }
    
    // Don't delete message - let it retry via visibility timeout
    // After max receives, it will go to DLQ
  }
}

/**
 * Delete message from SQS queue
 * @param {string} receiptHandle - Message receipt handle
 */
async function deleteMessage(receiptHandle) {
  try {
    const command = new DeleteMessageCommand({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: receiptHandle
    });
    await sqsClient.send(command);
    console.log('Message deleted from queue');
  } catch (error) {
    console.error('Error deleting message from queue:', error);
  }
}

/**
 * Poll SQS queue for messages
 */
async function pollQueue() {
  console.log(`Polling queue: ${QUEUE_URL}`);
  
  while (!isShuttingDown) {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: MAX_MESSAGES,
        WaitTimeSeconds: WAIT_TIME_SECONDS,
        VisibilityTimeout: VISIBILITY_TIMEOUT,
        AttributeNames: ['All']
      });
      
      const response = await sqsClient.send(command);
      
      if (response.Messages && response.Messages.length > 0) {
        console.log(`Received ${response.Messages.length} message(s)`);
        
        // Process messages sequentially
        for (const message of response.Messages) {
          if (isShuttingDown) {
            break;
          }
          await processMessage(message);
        }
      } else {
        console.log('No messages received, continuing to poll...');
      }
      
    } catch (error) {
      console.error('Error polling queue:', error);
      
      // Wait before retrying on error
      if (!isShuttingDown) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  console.log('Stopped polling queue');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  console.log(`Received ${signal}, starting graceful shutdown...`);
  isShuttingDown = true;
  
  // Give current message processing time to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Close database connection
  await closePool();
  
  console.log('Graceful shutdown complete');
  process.exit(0);
}

/**
 * Main function
 */
async function main() {
  console.log('=== S3 Scanner Worker Starting ===');
  console.log(`Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  console.log(`Queue URL: ${QUEUE_URL}`);
  
  if (!QUEUE_URL) {
    console.error('SQS_QUEUE_URL environment variable is not set');
    process.exit(1);
  }
  
  // Initialize database connection pool
  try {
    await initPool();
    console.log('Database connection pool initialized');
  } catch (error) {
    console.error('Failed to initialize database connection pool:', error);
    process.exit(1);
  }
  
  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Start polling
  console.log('Starting to poll SQS queue...');
  await pollQueue();
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the worker
main().catch((error) => {
  console.error('Fatal error in main:', error);
  process.exit(1);
});

