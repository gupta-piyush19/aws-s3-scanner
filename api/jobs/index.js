/**
 * GET /jobs/{job_id} Lambda Handler
 * Retrieves job status and object processing counts
 */

const { getPool } = require('./shared/db');

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event));
  
  try {
    // Get job_id from path parameters
    const jobId = event.pathParameters?.job_id;
    
    if (!jobId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing job_id path parameter' })
      };
    }
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid job_id format' })
      };
    }
    
    const pool = await getPool();
    
    // Get job details
    const jobQuery = 'SELECT job_id, bucket, prefix, created_at, updated_at FROM jobs WHERE job_id = $1';
    const jobResult = await pool.query(jobQuery, [jobId]);
    
    if (jobResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Job not found' })
      };
    }
    
    const job = jobResult.rows[0];
    
    // Get status counts
    const countsQuery = `
      SELECT status, COUNT(*) as count
      FROM job_objects
      WHERE job_id = $1
      GROUP BY status
    `;
    const countsResult = await pool.query(countsQuery, [jobId]);
    
    // Build counts object
    const counts = {
      queued: 0,
      processing: 0,
      succeeded: 0,
      failed: 0
    };
    
    countsResult.rows.forEach(row => {
      counts[row.status] = parseInt(row.count);
    });
    
    const totalCount = counts.queued + counts.processing + counts.succeeded + counts.failed;
    const completedCount = counts.succeeded + counts.failed;
    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    
    // Determine overall status
    let overallStatus = 'running';
    if (completedCount === totalCount && totalCount > 0) {
      overallStatus = 'completed';
    } else if (counts.queued === totalCount && totalCount > 0) {
      overallStatus = 'pending';
    }
    
    // Get findings count
    const findingsQuery = 'SELECT COUNT(*) as count FROM findings WHERE job_id = $1';
    const findingsResult = await pool.query(findingsQuery, [jobId]);
    const findingsCount = parseInt(findingsResult.rows[0].count);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.job_id,
        bucket: job.bucket,
        prefix: job.prefix,
        status: overallStatus,
        created_at: job.created_at,
        updated_at: job.updated_at,
        progress: {
          total: totalCount,
          completed: completedCount,
          percentage: progress
        },
        counts,
        findings_count: findingsCount
      })
    };
    
  } catch (error) {
    console.error('Error retrieving job status:', error);
    
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

