resource "aws_cloudwatch_log_group" "lambda_scan" {
  name              = "/aws/lambda/${local.name_prefix}-scan"
  retention_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-scan-logs"
  }
}

resource "aws_cloudwatch_log_group" "lambda_results" {
  name              = "/aws/lambda/${local.name_prefix}-results"
  retention_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-results-logs"
  }
}

resource "aws_cloudwatch_log_group" "lambda_jobs" {
  name              = "/aws/lambda/${local.name_prefix}-jobs"
  retention_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-jobs-logs"
  }
}
resource "null_resource" "lambda_scan_package" {
  triggers = {
    scan_code   = filemd5("${path.module}/../api/scan/index.js")
    shared_code = filemd5("${path.module}/../api/shared/db.js")
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      rm -rf ${path.module}/.terraform/lambda-scan-build
      mkdir -p ${path.module}/.terraform/lambda-scan-build
      cp ${path.module}/../api/scan/index.js ${path.module}/.terraform/lambda-scan-build/
      cp ${path.module}/../api/package*.json ${path.module}/.terraform/lambda-scan-build/
      mkdir -p ${path.module}/.terraform/lambda-scan-build/shared
      cp ${path.module}/../api/shared/db.js ${path.module}/.terraform/lambda-scan-build/shared/
      cd ${path.module}/.terraform/lambda-scan-build && npm install --production && zip -r ../lambda-scan.zip . -x "*.git*" > /dev/null
    EOT
  }
}

data "archive_file" "lambda_scan" {
  type        = "zip"
  source_dir  = "${path.module}/.terraform/lambda-scan-build"
  output_path = "${path.module}/.terraform/lambda-scan.zip"
  excludes    = ["*.git*"]
  
  depends_on = [null_resource.lambda_scan_package]
}

resource "aws_lambda_function" "scan" {
  filename         = data.archive_file.lambda_scan.output_path
  function_name    = "${local.name_prefix}-scan"
  role             = aws_iam_role.lambda_scan.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.lambda_scan.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512
  
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }
  
  environment {
    variables = {
      SQS_QUEUE_URL   = aws_sqs_queue.scan_jobs.url
      DB_SECRET_NAME  = aws_secretsmanager_secret.db_credentials.name
      DB_SSL          = "true"
    }
  }
  
  depends_on = [aws_cloudwatch_log_group.lambda_scan]
  
  tags = {
    Name = "${local.name_prefix}-scan-lambda"
  }
}

resource "null_resource" "lambda_results_package" {
  triggers = {
    results_code = filemd5("${path.module}/../api/results/index.js")
    shared_code  = filemd5("${path.module}/../api/shared/db.js")
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      rm -rf ${path.module}/.terraform/lambda-results-build
      mkdir -p ${path.module}/.terraform/lambda-results-build
      cp ${path.module}/../api/results/index.js ${path.module}/.terraform/lambda-results-build/
      cp ${path.module}/../api/package*.json ${path.module}/.terraform/lambda-results-build/
      mkdir -p ${path.module}/.terraform/lambda-results-build/shared
      cp ${path.module}/../api/shared/db.js ${path.module}/.terraform/lambda-results-build/shared/
      cd ${path.module}/.terraform/lambda-results-build && npm install --production && zip -r ../lambda-results.zip . -x "*.git*" > /dev/null
    EOT
  }
}

data "archive_file" "lambda_results" {
  type        = "zip"
  source_dir  = "${path.module}/.terraform/lambda-results-build"
  output_path = "${path.module}/.terraform/lambda-results.zip"
  excludes    = ["*.git*"]
  
  depends_on = [null_resource.lambda_results_package]
}

resource "aws_lambda_function" "results" {
  filename         = data.archive_file.lambda_results.output_path
  function_name    = "${local.name_prefix}-results"
  role             = aws_iam_role.lambda_query.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.lambda_results.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512
  
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }
  
  environment {
    variables = {
      DB_SECRET_NAME = aws_secretsmanager_secret.db_credentials.name
      DB_SSL         = "true"
    }
  }
  
  depends_on = [aws_cloudwatch_log_group.lambda_results]
  
  tags = {
    Name = "${local.name_prefix}-results-lambda"
  }
}

resource "null_resource" "lambda_jobs_package" {
  triggers = {
    jobs_code   = filemd5("${path.module}/../api/jobs/index.js")
    shared_code = filemd5("${path.module}/../api/shared/db.js")
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      rm -rf ${path.module}/.terraform/lambda-jobs-build
      mkdir -p ${path.module}/.terraform/lambda-jobs-build
      cp ${path.module}/../api/jobs/index.js ${path.module}/.terraform/lambda-jobs-build/
      cp ${path.module}/../api/package*.json ${path.module}/.terraform/lambda-jobs-build/
      mkdir -p ${path.module}/.terraform/lambda-jobs-build/shared
      cp ${path.module}/../api/shared/db.js ${path.module}/.terraform/lambda-jobs-build/shared/
      cd ${path.module}/.terraform/lambda-jobs-build && npm install --production && zip -r ../lambda-jobs.zip . -x "*.git*" > /dev/null
    EOT
  }
}

data "archive_file" "lambda_jobs" {
  type        = "zip"
  source_dir  = "${path.module}/.terraform/lambda-jobs-build"
  output_path = "${path.module}/.terraform/lambda-jobs.zip"
  excludes    = ["*.git*"]
  
  depends_on = [null_resource.lambda_jobs_package]
}

resource "aws_lambda_function" "jobs" {
  filename         = data.archive_file.lambda_jobs.output_path
  function_name    = "${local.name_prefix}-jobs"
  role             = aws_iam_role.lambda_query.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.lambda_jobs.output_base64sha256
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512
  
  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }
  
  environment {
    variables = {
      DB_SECRET_NAME = aws_secretsmanager_secret.db_credentials.name
      DB_SSL         = "true"
    }
  }
  
  depends_on = [aws_cloudwatch_log_group.lambda_jobs]
  
  tags = {
    Name = "${local.name_prefix}-jobs-lambda"
  }
}

