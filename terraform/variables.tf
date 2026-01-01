
variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "s3-scanner"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "scanner"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "scanneradmin"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "bastion_key_name" {
  description = "EC2 key pair name for bastion host (must exist in AWS)"
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed to SSH to bastion"
  type        = string
  default     = "0.0.0.0/0"
}

variable "ecs_task_cpu" {
  description = "CPU units for ECS task"
  type        = string
  default     = "512"
}

variable "ecs_task_memory" {
  description = "Memory for ECS task (MB)"
  type        = string
  default     = "1024"
}

variable "ecs_min_capacity" {
  description = "Minimum number of ECS tasks"
  type        = number
  default     = 1
}

variable "ecs_max_capacity" {
  description = "Maximum number of ECS tasks"
  type        = number
  default     = 5
}

variable "sqs_visibility_timeout" {
  description = "SQS visibility timeout in seconds"
  type        = number
  default     = 300
}

variable "sqs_max_receive_count" {
  description = "Maximum receives before sending to DLQ"
  type        = number
  default     = 3
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project   = "S3-Scanner"
    ManagedBy = "Terraform"
  }
}

