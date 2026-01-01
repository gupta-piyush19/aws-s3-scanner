-- Jobs table: tracks scan jobs
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY,
    bucket TEXT NOT NULL,
    prefix TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_bucket ON jobs(bucket);

-- Job objects table: tracks individual file processing status
CREATE TABLE IF NOT EXISTS job_objects (
    job_id UUID NOT NULL,
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    etag TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','processing','succeeded','failed')),
    last_error TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (job_id, bucket, key, etag),
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_objects_status ON job_objects(job_id, status);
CREATE INDEX IF NOT EXISTS idx_job_objects_updated_at ON job_objects(updated_at DESC);

-- Findings table: stores detected sensitive data
CREATE TABLE IF NOT EXISTS findings (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL,
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    etag TEXT NOT NULL,
    detector TEXT NOT NULL,
    masked_match TEXT NOT NULL,
    context TEXT,
    byte_offset INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);

-- Unique index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS findings_dedupe_idx 
ON findings (bucket, key, etag, detector, byte_offset);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_findings_job_id ON findings(job_id);
CREATE INDEX IF NOT EXISTS idx_findings_bucket_key ON findings(bucket, key);
CREATE INDEX IF NOT EXISTS idx_findings_detector ON findings(detector);
CREATE INDEX IF NOT EXISTS idx_findings_created_at ON findings(created_at DESC);

