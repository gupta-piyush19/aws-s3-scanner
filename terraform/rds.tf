resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
  
  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-db"
  
  engine         = "postgres"
  engine_version = "15"
  instance_class = var.db_instance_class
  
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result
  port     = 5432
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  
  backup_retention_period = 1
  backup_window          = "03:00-04:00"
  maintenance_window     = "mon:04:00-mon:05:00"
  
  skip_final_snapshot       = true
  final_snapshot_identifier = null
  
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  
  auto_minor_version_upgrade = true
  
  multi_az = false
  
  tags = {
    Name = "${local.name_prefix}-postgres-db"
  }
}

resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${local.name_prefix}-db-credentials"
  description             = "Database credentials for S3 Scanner"
  recovery_window_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-db-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = aws_db_instance.postgres.username
    password = random_password.db_password.result
    host     = aws_db_instance.postgres.address
    port     = aws_db_instance.postgres.port
    dbname   = aws_db_instance.postgres.db_name
    engine   = "postgres"
  })
}

