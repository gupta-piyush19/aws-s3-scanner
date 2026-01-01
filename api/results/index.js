const { getPool } = require("./shared/db");

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  try {
    const params = event.queryStringParameters || {};
    const bucket = params.bucket;
    const prefix = params.prefix;
    const limit = parseInt(params.limit || "100");
    const cursor = params.cursor ? parseInt(params.cursor) : null;

    if (limit < 1 || limit > 1000) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Limit must be between 1 and 1000" }),
      };
    }

    let query =
      "SELECT id, job_id, bucket, key, detector, masked_match, context, byte_offset, created_at FROM findings WHERE 1=1";
    const values = [];
    let paramIndex = 1;

    if (bucket) {
      query += ` AND bucket = $${paramIndex}`;
      values.push(bucket);
      paramIndex++;
    }

    if (prefix) {
      query += ` AND key LIKE $${paramIndex}`;
      values.push(`${prefix}%`);
      paramIndex++;
    }

    if (cursor) {
      query += ` AND id > $${paramIndex}`;
      values.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY id ASC LIMIT $${paramIndex}`;
    values.push(limit);

    console.log("Query:", query);
    console.log("Values:", values);

    const pool = await getPool();
    const result = await pool.query(query, values);

    const findings = result.rows.map((row) => ({
      id: row.id.toString(),
      job_id: row.job_id,
      bucket: row.bucket,
      key: row.key,
      detector: row.detector,
      masked_match: row.masked_match,
      context: row.context,
      byte_offset: row.byte_offset,
      created_at: row.created_at,
    }));

    let nextCursor = null;
    if (findings.length === limit) {
      nextCursor = findings[findings.length - 1].id;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        findings,
        count: findings.length,
        next_cursor: nextCursor,
      }),
    };
  } catch (error) {
    console.error("Error retrieving results:", error);

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
};
