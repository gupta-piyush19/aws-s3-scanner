
resource "aws_s3_bucket" "scanner_files" {
  bucket = "${local.name_prefix}-files-${local.account_id}"
  
  tags = {
    Name = "${local.name_prefix}-files"
  }
}
  
resource "aws_s3_bucket_versioning" "scanner_files" {
  bucket = aws_s3_bucket.scanner_files.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "scanner_files" {
  bucket = aws_s3_bucket.scanner_files.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scanner_files" {
  bucket = aws_s3_bucket.scanner_files.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "scanner_files" {
  bucket = aws_s3_bucket.scanner_files.id
  
  rule {
    id     = "delete-old-versions"
    status = "Enabled"
    
    filter {}
    
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

resource "aws_s3_bucket_policy" "scanner_files" {
  bucket = aws_s3_bucket.scanner_files.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowECSTaskRead"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.ecs_task.arn
        }
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.scanner_files.arn,
          "${aws_s3_bucket.scanner_files.arn}/*"
        ]
      },
      {
        Sid    = "AllowLambdaRead"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.lambda_scan.arn
        }
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.scanner_files.arn,
          "${aws_s3_bucket.scanner_files.arn}/*"
        ]
      }
    ]
  })
  
  depends_on = [
    aws_iam_role.ecs_task,
    aws_iam_role.lambda_scan
  ]
}

