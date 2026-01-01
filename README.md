# AWS S3 Sensitive Data Scanner

A scalable, AWS-based service that scans S3 files containing hundreds of terabytes for sensitive data and exposes APIs to trigger scans, fetch results, and retrieve job statuses.

## Features

- 🔍 **Comprehensive Detection**: Identifies SSN, credit cards, AWS keys, emails, and US phone numbers
- 🚀 **Scalable Architecture**: Handles files ranging from KBs to hundreds of MBs across terabytes of data
- 📊 **RESTful APIs**: Simple HTTP endpoints for job management and results retrieval
- 🔄 **Asynchronous Processing**: SQS-based message queue with automatic retry and DLQ
- 📈 **Auto-scaling**: ECS Fargate tasks scale automatically based on queue depth
- 🔒 **Secure**: VPC isolation, encryption at rest, IAM-based access control
- 💾 **Persistent Storage**: PostgreSQL database with deduplication and indexing

## Architecture

```
Client → API Gateway → Lambda Functions → SQS Queue → ECS Fargate Workers → S3 + RDS
```

## Components

### Infrastructure (Terraform)

- **VPC**: Public and private subnets with NAT Gateway
- **RDS PostgreSQL**: Stores jobs, processing status, and findings
- **ECS Fargate**: Scanner worker containers that process files
- **SQS**: Main queue with DLQ for failed messages
- **API Gateway**: HTTP API with three endpoints
- **Lambda**: Serverless functions for API handlers
- **S3**: Storage bucket for test files
- **Bastion**: EC2 instance for database access

### Scanner Worker (Node.js)

- Polls SQS for file processing tasks
- Downloads files from S3 (supports .txt, .csv, .json, .log)
- Detects sensitive data using regex patterns and context analysis
- Stores findings in PostgreSQL with deduplication
- Updates job status and handles errors gracefully

### API Endpoints

- **POST /scan**: Create a new scan job for S3 bucket/prefix
- **GET /results**: Retrieve findings with pagination and filters
- **GET /jobs/{job_id}**: Get job status, progress, and counts

## Quick Start

### Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Terraform 1.5+
- Node.js 20+
- Docker
- PostgreSQL client (for DB initialization)

### 1. Clone Repository

```bash
git clone https://github.com/yourname/aws-s3-scanner.git
cd aws-s3-scanner
```

### 2. Configure Terraform Variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your settings
vi terraform.tfvars
```

Key variables to set:

- `aws_region`: AWS region (default: us-east-1)
- `bastion_key_name`: EC2 key pair name for SSH access
- `allowed_ssh_cidr`: Your IP address for bastion access

### 3. Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Review planned changes
terraform plan

# Deploy (takes ~15 minutes)
terraform apply

# Save outputs
terraform output -json > outputs.json
```

### 4. Initialize Database

From bastion host:

```bash
# SSH to bastion
ssh -i ~/.ssh/your-key.pem ec2-user@<BASTION_IP>

# Get DB credentials from Secrets Manager and apply schema
# See TESTING.md for detailed instructions
```

Or use the provided script:

```bash
# On bastion
export DB_HOST=<rds-endpoint>
export DB_NAME=scanner
export DB_USER=scanneradmin
export DB_PASSWORD=<from-secrets-manager>

```

### 5. Build and Deploy Scanner Worker

```bash
cd scanner
npm install

# Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push Docker image
docker build -t s3-scanner:latest .
docker tag s3-scanner:latest <ECR_REPOSITORY_URL>:latest
docker push <ECR_REPOSITORY_URL>:latest

# Update ECS service
aws ecs update-service \
  --cluster s3-scanner-prod-cluster \
  --service s3-scanner-prod-scanner-service \
  --force-new-deployment \
  --region us-east-1
```

### 6. Install Lambda Dependencies

```bash
cd api
npm install

# Dependencies are automatically packaged by Terraform
# Reapply to update Lambda functions
cd ../terraform
terraform apply
```

### 7. Upload Test Files

```bash
cd scripts
npm install

export S3_BUCKET_NAME=$(terraform output -raw s3_bucket_name)
export AWS_REGION=us-east-1

node upload-test-files.js
```

### 8. Run a Scan

```bash
export API_URL=$(terraform output -raw api_gateway_url)
export S3_BUCKET=$(terraform output -raw s3_bucket_name)

# Create scan job
curl -X POST "${API_URL}/scan" \
  -H "Content-Type: application/json" \
  -d "{\"bucket\":\"${S3_BUCKET}\",\"prefix\":\"test-data/\"}" | jq '.'

# Save job_id from response
export JOB_ID="<job-id-from-response>"

# Check job status
curl "${API_URL}/jobs/${JOB_ID}" | jq '.'

# Get findings
curl "${API_URL}/results?bucket=${S3_BUCKET}&limit=50" | jq '.'
```

## API Documentation

### POST /scan

Create a new scan job.

**Request**:

```json
{
  "bucket": "my-bucket",
  "prefix": "path/to/files/" // optional
}
```

**Response**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Scan initiated successfully",
  "object_count": 1234,
  "enqueued_count": 1234
}
```

### GET /jobs/{job_id}

Get job status and progress.

**Response**:

```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "bucket": "my-bucket",
  "prefix": "path/to/files/",
  "status": "running",
  "created_at": "2025-01-01T12:00:00Z",
  "updated_at": "2025-01-01T12:05:00Z",
  "progress": {
    "total": 1234,
    "completed": 567,
    "percentage": 46
  },
  "counts": {
    "queued": 500,
    "processing": 10,
    "succeeded": 557,
    "failed": 10
  },
  "findings_count": 892
}
```

### GET /results

Retrieve findings with filters and pagination.

**Query Parameters**:

- `bucket` (optional): Filter by S3 bucket
- `prefix` (optional): Filter by key prefix
- `limit` (optional): Results per page (default: 100, max: 1000)
- `cursor` (optional): Pagination cursor from previous response

**Response**:

```json
{
  "findings": [
    {
      "id": "12345",
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "bucket": "my-bucket",
      "key": "path/to/file.txt",
      "detector": "SSN",
      "masked_match": "***-**-6789",
      "context": "SSN: 123-45-6789 found in record",
      "byte_offset": 1234,
      "created_at": "2025-01-01T12:05:30Z"
    }
  ],
  "count": 100,
  "next_cursor": "12445"
}
```

## Sensitive Data Detection

The scanner detects the following types of sensitive data:

| Type               | Pattern              | Validation | Context Required               |
| ------------------ | -------------------- | ---------- | ------------------------------ |
| **SSN**            | `\d{3}-\d{2}-\d{4}`  | None       | Yes (ssn, social security)     |
| **Credit Card**    | 13-19 digits         | Luhn check | Yes (card, credit, visa, etc.) |
| **AWS Access Key** | `AKIA[0-9A-Z]{16}`   | None       | No                             |
| **AWS Secret Key** | 40-char base64       | None       | Yes (secret, aws_secret)       |
| **Email**          | Standard email regex | None       | No                             |
| **US Phone**       | Multiple formats     | None       | Yes (phone, tel, mobile)       |

### Supported File Types

- `.txt` - Plain text files
- `.csv` - Comma-separated values
- `.json` - JSON documents
- `.log` - Log files

Files larger than 100 MB are skipped with an error message.

## Configuration

### Terraform Variables

See `terraform/terraform.tfvars.example` for all available variables:

- **Infrastructure**: Region, VPC CIDR, availability zones
- **Database**: Instance class, name, username
- **ECS**: CPU, memory, min/max capacity
- **SQS**: Visibility timeout, max receive count
- **Bastion**: Key pair name, allowed SSH CIDR

### Environment Variables

**Scanner Worker**:

- `AWS_REGION`: AWS region
- `SQS_QUEUE_URL`: SQS queue URL
- `DB_SECRET_NAME`: Secrets Manager secret name
- `DB_SSL`: Enable SSL for database connection

**Lambda Functions**:

- `AWS_REGION`: AWS region
- `SQS_QUEUE_URL`: SQS queue URL (scan function only)
- `DB_SECRET_NAME`: Secrets Manager secret name
- `DB_SSL`: Enable SSL for database connection

## Monitoring

### CloudWatch Logs

- Lambda functions: `/aws/lambda/<function-name>`
- ECS tasks: `/ecs/s3-scanner-prod-scanner`
- API Gateway: `/aws/apigateway/s3-scanner-prod`

### CloudWatch Alarms

- **High Queue Depth**: Triggers when SQS queue has > 1000 messages
- **DLQ Messages**: Triggers when messages appear in dead-letter queue

### Metrics to Monitor

- **SQS**: ApproximateNumberOfMessagesVisible, ApproximateAgeOfOldestMessage
- **ECS**: RunningTaskCount, CPUUtilization, MemoryUtilization
- **RDS**: CPUUtilization, DatabaseConnections, FreeStorageSpace
- **Lambda**: Invocations, Errors, Duration

## Scaling

### Auto-scaling Configuration

ECS tasks scale automatically based on SQS queue depth:

- **Target**: 10 messages per task
- **Min Capacity**: 1 task
- **Max Capacity**: 5 tasks
- **Scale Out Cooldown**: 60 seconds
- **Scale In Cooldown**: 300 seconds

## Security

### Network Security

- RDS and ECS tasks deployed in private subnets
- No public IP addresses on worker instances
- NAT Gateway for internet access (AWS API calls)
- Bastion host in public subnet for administrative access

### Encryption

- **At Rest**: RDS, S3, SQS all use encryption
- **In Transit**: HTTPS for API, SSL for database connections
- **Secrets**: Stored in AWS Secrets Manager with KMS encryption

### IAM Permissions

- Least privilege access for all components
- Separate roles for ECS tasks and Lambda functions
- No wildcard permissions

### Project Structure

```
├── terraform/          # Infrastructure as code
├── scanner/           # ECS Fargate worker
│   ├── src/
│   │   ├── index.js       # Main worker loop
│   │   ├── detectors.js   # Sensitive data detection
│   │   ├── db.js          # Database operations
│   │   └── s3-handler.js  # S3 file operations
│   └── Dockerfile
├── api/               # Lambda functions
│   ├── scan/          # POST /scan handler
│   ├── results/       # GET /results handler
│   ├── jobs/          # GET /jobs/:id handler
│   └── shared/        # Shared utilities
├── db/                # Database schema
├── scripts/           # Test utilities
├── architecture.md    # Architecture documentation
├── TESTING.md        # Testing guide
└── README.md         # This file
```

## Cleanup

To destroy all resources:

```bash
cd terraform
terraform destroy
```

**Warning**: This will permanently delete:

- All S3 files and findings
- RDS database and all data
- CloudWatch logs
- All infrastructure
