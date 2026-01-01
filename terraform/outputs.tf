
output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.postgres.endpoint
}

output "rds_database_name" {
  description = "RDS database name"
  value       = aws_db_instance.postgres.db_name
}

output "db_secret_name" {
  description = "Secrets Manager secret name for database credentials"
  value       = aws_secretsmanager_secret.db_credentials.name
}

output "sqs_queue_url" {
  description = "SQS main queue URL"
  value       = aws_sqs_queue.scan_jobs.url
}

output "sqs_dlq_url" {
  description = "SQS DLQ URL"
  value       = aws_sqs_queue.dlq.url
}

output "s3_bucket_name" {
  description = "S3 bucket name for scanner files"
  value       = aws_s3_bucket.scanner_files.id
}

output "ecr_repository_url" {
  description = "ECR repository URL for scanner image"
  value       = aws_ecr_repository.scanner.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.scanner.name
}

output "api_gateway_url" {
  description = "API Gateway invoke URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "bastion_public_ip" {
  description = "Bastion host public IP"
  value       = aws_eip.bastion.public_ip
}

output "bastion_instance_id" {
  description = "Bastion instance ID"
  value       = aws_instance.bastion.id
}
    
output "deployment_summary" {
  description = "Deployment summary"
  value = {
    api_url            = aws_apigatewayv2_api.main.api_endpoint
    s3_bucket          = aws_s3_bucket.scanner_files.id
    rds_endpoint       = aws_db_instance.postgres.endpoint
    bastion_ip         = aws_eip.bastion.public_ip
    ecr_repository     = aws_ecr_repository.scanner.repository_url
    ecs_cluster        = aws_ecs_cluster.main.name
    sqs_queue          = aws_sqs_queue.scan_jobs.name
  }
}

