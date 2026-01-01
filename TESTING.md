# Testing Guide

This guide provides step-by-step instructions for testing the S3 Scanner Service.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 20+ installed
- PostgreSQL client (psql) installed on bastion host
- SSH key pair for bastion access

## Deployment Steps

### 1. Deploy Infrastructure with Terraform

```bash
cd terraform

# Initialize Terraform
terraform init

# Review the plan
terraform plan

# Deploy infrastructure (takes ~15 minutes)
terraform apply

# Save outputs for later use
terraform output -json > outputs.json
```

**Important Outputs**:

- `api_gateway_url`: Base URL for API calls
- `s3_bucket_name`: S3 bucket for test files
- `ecr_repository_url`: ECR repository for scanner image
- `bastion_public_ip`: Bastion host IP address
- `rds_endpoint`: Database endpoint
- `sqs_queue_url`: SQS queue URL

### 2. Initialize Database Schema

From your bastion host:

```bash
# SSH to bastion (replace with your key and IP)
ssh -i ~/.ssh/your-key.pem ec2-user@<BASTION_IP>

# Get database credentials from Secrets Manager
export DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id s3-scanner-prod-db-credentials \
  --query SecretString \
  --output text)

export DB_HOST=$(echo $DB_SECRET | jq -r '.host')
export DB_USER=$(echo $DB_SECRET | jq -r '.username')
export DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')
export DB_NAME=$(echo $DB_SECRET | jq -r '.dbname')

# Download and run init script
curl -o schema.sql https://raw.githubusercontent.com/gupta-piyush19/aws-s3-scanner/main/db/schema.sql

# Apply schema
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f schema.sql

# Verify tables
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "\dt"
```

### 3. Build and Push Scanner Docker Image

```bash
cd scanner

# Install dependencies
npm install

# Get ECR login credentials
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build Docker image
docker build -t s3-scanner:latest .

# Tag for ECR
docker tag s3-scanner:latest <ECR_REPOSITORY_URL>:latest

# Push to ECR
docker push <ECR_REPOSITORY_URL>:latest
```

### 4. Install Lambda Dependencies and Update Functions

```bash
# For each Lambda function, install dependencies
cd api/scan
npm install
cd ../results
npm install
cd ../jobs
npm install
cd ../shared
npm install
cd ../..

# Lambda functions are automatically packaged by Terraform
# Force update to use new code
terraform apply -replace="aws_lambda_function.scan" \
                -replace="aws_lambda_function.results" \
                -replace="aws_lambda_function.jobs"
```

### 5. Update ECS Service to Use New Image

```bash
# Force new deployment with latest image
aws ecs update-service \
  --cluster s3-scanner-prod-cluster \
  --service s3-scanner-prod-scanner-service \
  --force-new-deployment \
  --region us-east-1
```

## Test Scenarios

### Test 1: Upload Test Files

Generate and upload 500+ files with sensitive data:

```bash
cd scripts
npm install

# Upload test files
export S3_BUCKET_NAME="s3-scanner-prod-files-123456789012"
export AWS_REGION="us-east-1"

node upload-test-files.js
```

**Expected Output**:

```
=== S3 Test File Upload Script ===
Bucket: s3-scanner-prod-files-123456789012
Prefix: test-data/
Files to create: 550

Uploaded 50 files...
Uploaded 100 files...
...
Uploaded 550 files...

=== Upload Complete ===
Total files uploaded: 550
Files with sensitive data: 165
Files without sensitive data: 385
```

**Verify Upload**:

```bash
aws s3 ls s3://s3-scanner-prod-files-123456789012/test-data/ | wc -l
# Should show 550
```

### Test 2: Create a Scan Job

Initiate a scan of the test files:

```bash
# Set API endpoint (from Terraform outputs)
export API_URL="https://abc123xyz.execute-api.us-east-1.amazonaws.com"

# Create scan job
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d '{
    "bucket": "s3-scanner-prod-files-123456789012",
    "prefix": "test-data/"
  }' | jq '.'
```

**Expected Response**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Scan initiated successfully",
  "object_count": 550,
  "enqueued_count": 550
}
```

**Save the job_id** for subsequent API calls.

### Test 3: Monitor Job Progress

Poll the job status API to track progress:

```bash
export JOB_ID="550e8400-e29b-41d4-a716-446655440000"

# Check job status (run multiple times)
curl "${API_URL}/jobs/${JOB_ID}" | jq '.'
```

**Expected Response (in progress)**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "bucket": "s3-scanner-prod-files-123456789012",
  "prefix": "test-data/",
  "status": "running",
  "created_at": "2025-01-01T12:00:00.000Z",
  "updated_at": "2025-01-01T12:05:00.000Z",
  "progress": {
    "total": 550,
    "completed": 245,
    "percentage": 45
  },
  "counts": {
    "queued": 200,
    "processing": 5,
    "succeeded": 240,
    "failed": 5
  },
  "findings_count": 325
}
```

**Expected Response (completed)**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "bucket": "s3-scanner-prod-files-123456789012",
  "prefix": "test-data/",
  "status": "completed",
  "created_at": "2025-01-01T12:00:00.000Z",
  "updated_at": "2025-01-01T12:15:00.000Z",
  "progress": {
    "total": 550,
    "completed": 550,
    "percentage": 100
  },
  "counts": {
    "queued": 0,
    "processing": 0,
    "succeeded": 548,
    "failed": 2
  },
  "findings_count": 487
}
```

### Test 4: Retrieve Findings

Fetch the detected sensitive data:

```bash
# Get first page of results
curl "${API_URL}/results?bucket=s3-scanner-prod-files-123456789012&limit=50" | jq '.'

# Get results for specific prefix
curl "${API_URL}/results?bucket=s3-scanner-prod-files-123456789012&prefix=test-data/&limit=100" | jq '.'

# Paginate through results using cursor
curl "${API_URL}/results?bucket=s3-scanner-prod-files-123456789012&limit=100&cursor=1234567" | jq '.'
```

**Expected Response**:

```json
{
  "findings": [
    {
      "id": "12345",
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "bucket": "s3-scanner-prod-files-123456789012",
      "key": "test-data/file-0001.txt",
      "detector": "SSN",
      "masked_match": "***-**-6789",
      "context": "Employee record contains SSN: 123-45-6789 for verification",
      "byte_offset": 1234,
      "created_at": "2025-01-01T12:05:30.000Z"
    },
    {
      "id": "12346",
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "bucket": "s3-scanner-prod-files-123456789012",
      "key": "test-data/file-0002.json",
      "detector": "EMAIL",
      "masked_match": "jo***@example.com",
      "context": "{\"email\":\"john.doe@example.com\",\"name\":\"John Doe\"}",
      "byte_offset": 567,
      "created_at": "2025-01-01T12:05:35.000Z"
    }
  ],
  "count": 2,
  "next_cursor": "12347"
}
```

### Test 5: Monitor SQS Queue

Check queue depth and DLQ:

```bash
# Get main queue attributes
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/123456789012/s3-scanner-prod-scan-jobs" \
  --attribute-names All \
  --region us-east-1 | jq '.Attributes'

# Check approximate number of visible messages
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/123456789012/s3-scanner-prod-scan-jobs" \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region us-east-1
```

**Expected Output**:

```json
{
  "Attributes": {
    "ApproximateNumberOfMessages": "150",
    "ApproximateNumberOfMessagesNotVisible": "5",
    "ApproximateNumberOfMessagesDelayed": "0"
  }
}
```

**Check DLQ**:

```bash
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/123456789012/s3-scanner-prod-scan-jobs-dlq" \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1
```

**Expected**: 0 messages (or investigate if messages present)

### Test 6: Monitor ECS Task Scaling

Watch ECS tasks scale based on queue depth:

```bash
# List running tasks
aws ecs list-tasks \
  --cluster s3-scanner-prod-cluster \
  --service-name s3-scanner-prod-scanner-service \
  --region us-east-1

# Describe service
aws ecs describe-services \
  --cluster s3-scanner-prod-cluster \
  --services s3-scanner-prod-scanner-service \
  --region us-east-1 | jq '.services[0] | {desiredCount, runningCount}'
```

**Expected**: Tasks scale from 1 to 5 based on queue depth

### Test 7: View CloudWatch Logs

Check logs for Lambda and ECS:

```bash
# Lambda scan function logs
aws logs tail /aws/lambda/s3-scanner-prod-scan --follow --region us-east-1

# ECS scanner worker logs
aws logs tail /ecs/s3-scanner-prod-scanner --follow --region us-east-1

# API Gateway logs
aws logs tail /aws/apigateway/s3-scanner-prod --follow --region us-east-1
```

### Test 8: Error Handling

Test error scenarios:

**Invalid bucket name**:

```bash
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d '{"bucket": "nonexistent-bucket"}' | jq '.'
```

**Expected**: HTTP 500 with error message

**Missing bucket parameter**:

```bash
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.'
```

**Expected**: HTTP 400 with "Missing required field: bucket"

**Invalid job_id format**:

```bash
curl "${API_URL}/jobs/invalid-uuid" | jq '.'
```

**Expected**: HTTP 400 with "Invalid job_id format"

**Non-existent job**:

```bash
curl "${API_URL}/jobs/550e8400-0000-0000-0000-000000000000" | jq '.'
```

**Expected**: HTTP 404 with "Job not found"

### Test 9: Verify Detection Accuracy

Create a test file with known sensitive data:

```bash
# Create test file
cat > /tmp/test-sensitive.txt <<EOF
This is a test file containing sensitive information:
Social Security Number: 123-45-6789
Credit Card: 4532015112830366
AWS Access Key: AKIAIOSFODNN7EXAMPLE
Email: john.doe@example.com
Phone: 555-123-4567
EOF

# Upload to S3
aws s3 cp /tmp/test-sensitive.txt s3://s3-scanner-prod-files-123456789012/manual-test/

# Create scan job
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d '{"bucket": "s3-scanner-prod-files-123456789012", "prefix": "manual-test/"}' | jq '.'

# Wait 30 seconds, then check results
sleep 30
curl "${API_URL}/results?bucket=s3-scanner-prod-files-123456789012&prefix=manual-test/" | jq '.'
```

**Expected**: 5 findings (SSN, Credit Card, AWS Key, Email, Phone)

### Test 10: Performance Testing

Test with larger file counts:

```bash
# Upload 1000+ files
export S3_BUCKET_NAME="s3-scanner-prod-files-123456789012"
# Modify FILE_COUNT in upload-test-files.js to 1000
node upload-test-files.js

# Create scan
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d '{"bucket": "s3-scanner-prod-files-123456789012", "prefix": "test-data/"}' | jq '.'

# Monitor processing time
time while true; do
  STATUS=$(curl -s "${API_URL}/jobs/${JOB_ID}" | jq -r '.status')
  echo "Status: $STATUS at $(date)"
  if [ "$STATUS" == "completed" ]; then
    break
  fi
  sleep 30
done
```

**Expected**: All files processed within reasonable time (depends on file sizes and content)

## Cleanup

To avoid ongoing costs, destroy the infrastructure when testing is complete:

```bash
cd terraform

# Destroy all resources
terraform destroy

# Confirm with 'yes'
```

**Note**: This will delete:

- All S3 files
- RDS database and data
- ECS tasks and logs
- Lambda functions
- VPC and networking

**Before destroying**:

- Export any important findings data
- Save CloudWatch logs if needed
- Remove any manually created resources
