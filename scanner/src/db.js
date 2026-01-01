/**
 * Database operations for scanner worker
 */

const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

let pool = null;
let dbConfig = null;

/**
 * Get database credentials from AWS Secrets Manager
 */
async function getDbCredentials() {
  if (dbConfig) {
    return dbConfig;
  }
  
  const secretName = process.env.DB_SECRET_NAME;
  if (!secretName) {
    throw new Error('DB_SECRET_NAME environment variable not set');
  }
  
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    
    const secret = JSON.parse(response.SecretString);
    dbConfig = {
      host: secret.host,
      port: secret.port || 5432,
      database: secret.dbname || 'scanner',
      user: secret.username,
      password: secret.password,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
    
    return dbConfig;
  } catch (error) {
    console.error('Error fetching database credentials:', error);
    throw error;
  }
}

/**
 * Initialize database connection pool
 */
async function initPool() {
  if (pool) {
    return pool;
  }
  
  const config = await getDbCredentials();
  pool = new Pool(config);
  
  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });
  
  // Test connection
  try {
    const client = await pool.connect();
    console.log('Database connection established successfully');
    client.release();
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
  
  return pool;
}

/**
 * Get database pool (initialize if needed)
 */
async function getPool() {
  if (!pool) {
    await initPool();
  }
  return pool;
}

/**
 * Update job object status
 * @param {string} jobId - Job ID
 * @param {string} bucket - S3 bucket
 * @param {string} key - S3 object key
 * @param {string} etag - S3 object ETag
 * @param {string} status - Status (queued, processing, succeeded, failed)
 * @param {string} error - Error message (if failed)
 */
async function updateJobObjectStatus(jobId, bucket, key, etag, status, error = null) {
  const pool = await getPool();
  const query = `
    UPDATE job_objects
    SET status = $1, last_error = $2, updated_at = NOW()
    WHERE job_id = $3 AND bucket = $4 AND key = $5 AND etag = $6
  `;
  
  try {
    await pool.query(query, [status, error, jobId, bucket, key, etag]);
  } catch (err) {
    console.error('Error updating job object status:', err);
    throw err;
  }
}

/**
 * Insert findings into database with deduplication
 * @param {Array} findings - Array of finding objects
 * @returns {number} - Number of findings inserted
 */
async function insertFindings(findings) {
  if (!findings || findings.length === 0) {
    return 0;
  }
  
  const pool = await getPool();
  
  // Use ON CONFLICT to handle deduplication
  const query = `
    INSERT INTO findings (job_id, bucket, key, etag, detector, masked_match, context, byte_offset)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (bucket, key, etag, detector, byte_offset) DO NOTHING
  `;
  
  let insertedCount = 0;
  
  // Insert findings one by one (or use batch insert for better performance)
  for (const finding of findings) {
    try {
      const result = await pool.query(query, [
        finding.job_id,
        finding.bucket,
        finding.key,
        finding.etag,
        finding.detector,
        finding.masked_match,
        finding.context || null,
        finding.byte_offset
      ]);
      
      if (result.rowCount > 0) {
        insertedCount++;
      }
    } catch (err) {
      // Log but don't fail on individual insert errors
      console.error('Error inserting finding:', err.message);
    }
  }
  
  return insertedCount;
}

/**
 * Check if a file has already been processed (dedupe check)
 * @param {string} bucket - S3 bucket
 * @param {string} key - S3 object key
 * @param {string} etag - S3 object ETag
 * @returns {boolean} - True if already processed
 */
async function checkDedupe(bucket, key, etag) {
  const pool = await getPool();
  const query = `
    SELECT COUNT(*) as count
    FROM findings
    WHERE bucket = $1 AND key = $2 AND etag = $3
    LIMIT 1
  `;
  
  try {
    const result = await pool.query(query, [bucket, key, etag]);
    return parseInt(result.rows[0].count) > 0;
  } catch (err) {
    console.error('Error checking dedupe:', err);
    return false; // On error, proceed with processing
  }
}

/**
 * Close database connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

module.exports = {
  initPool,
  getPool,
  updateJobObjectStatus,
  insertFindings,
  checkDedupe,
  closePool
};

