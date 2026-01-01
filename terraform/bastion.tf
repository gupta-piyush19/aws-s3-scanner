data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]
  
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# IAM Role for Bastion Host
resource "aws_iam_role" "bastion" {
  name = "${local.name_prefix}-bastion-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
  
  tags = {
    Name = "${local.name_prefix}-bastion-role"
  }
}

# IAM Policy for Bastion to access Secrets Manager
resource "aws_iam_role_policy" "bastion_secrets" {
  name = "${local.name_prefix}-bastion-secrets-policy"
  role = aws_iam_role.bastion.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.db_credentials.arn
      }
    ]
  })
}

# IAM Instance Profile for Bastion
resource "aws_iam_instance_profile" "bastion" {
  name = "${local.name_prefix}-bastion-profile"
  role = aws_iam_role.bastion.name
  
  tags = {
    Name = "${local.name_prefix}-bastion-profile"
  }
}

# EC2 Instance for Bastion
resource "aws_instance" "bastion" {
  ami           = data.aws_ami.amazon_linux_2023.id
  instance_type = "t3.micro"
  
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  
  key_name = var.bastion_key_name != "" ? var.bastion_key_name : null
  
  user_data = <<-EOF
              #!/bin/bash
              yum update -y
              yum install -y postgresql15 jq
              
              # Install AWS CLI (already included in AL2023)
              
              # Create helper script for DB connection
              cat > /home/ec2-user/connect-db.sh <<'SCRIPT'
              #!/bin/bash
              echo "Connecting to RDS database..."
              echo "Host: ${aws_db_instance.postgres.address}"
              echo "Port: ${aws_db_instance.postgres.port}"
              echo "Database: ${aws_db_instance.postgres.db_name}"
              echo "Username: ${aws_db_instance.postgres.username}"
              echo ""
              echo "To connect, run:"
              echo "psql -h ${aws_db_instance.postgres.address} -p ${aws_db_instance.postgres.port} -U ${aws_db_instance.postgres.username} -d ${aws_db_instance.postgres.db_name}"
              SCRIPT
              
              chmod +x /home/ec2-user/connect-db.sh
              chown ec2-user:ec2-user /home/ec2-user/connect-db.sh
              EOF
  
  tags = {
    Name = "${local.name_prefix}-bastion"
  }
  
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip" "bastion" {
  domain   = "vpc"
  instance = aws_instance.bastion.id
  
  depends_on = [aws_internet_gateway.main]
  
  tags = {
    Name = "${local.name_prefix}-bastion-eip"
  }
}

