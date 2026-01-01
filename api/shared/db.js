const { Pool } = require("pg");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

let pool = null;
let dbConfig = null;

async function getDbCredentials() {
  if (dbConfig) {
    return dbConfig;
  }

  const secretName = process.env.DB_SECRET_NAME;
  if (!secretName) {
    throw new Error("DB_SECRET_NAME environment variable not set");
  }

  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    const secret = JSON.parse(response.SecretString);
    dbConfig = {
      host: secret.host,
      port: secret.port || 5432,
      database: secret.dbname || "scanner",
      user: secret.username,
      password: secret.password,
      ssl:
        process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

    return dbConfig;
  } catch (error) {
    console.error("Error fetching database credentials:", error);
    throw error;
  }
}

async function getPool() {
  if (pool) {
    return pool;
  }

  const config = await getDbCredentials();
  pool = new Pool(config);

  pool.on("error", (err) => {
    console.error("Unexpected database error:", err);
  });

  return pool;
}

module.exports = {
  getPool,
};
