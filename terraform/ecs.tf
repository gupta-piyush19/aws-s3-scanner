resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  
  tags = {
    Name = "${local.name_prefix}-cluster"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "scanner" {
  name              = "/ecs/${local.name_prefix}-scanner"
  retention_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-scanner-logs"
  }
}

resource "aws_ecs_task_definition" "scanner" {
  family                   = "${local.name_prefix}-scanner"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.ecs_task_cpu
  memory                   = var.ecs_task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([{
    name      = "scanner"
    image     = "${aws_ecr_repository.scanner.repository_url}:latest"
    essential = true
    
    environment = [
      {
        name  = "SQS_QUEUE_URL"
        value = aws_sqs_queue.scan_jobs.url
      },
      {
        name  = "DB_SECRET_NAME"
        value = aws_secretsmanager_secret.db_credentials.name
      },
      {
        name  = "DB_SSL"
        value = "true"
      }
    ]
    
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.scanner.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "scanner"
      }
    }
    
    healthCheck = {
      command     = ["CMD-SHELL", "pgrep -x node || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])
  
  tags = {
    Name = "${local.name_prefix}-scanner-task"
  }
}

resource "aws_ecs_service" "scanner" {
  name            = "${local.name_prefix}-scanner-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.scanner.arn
  desired_count   = var.ecs_min_capacity
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }
  
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_maximum_percent = 200
  deployment_minimum_healthy_percent = 100
  
  tags = {
    Name = "${local.name_prefix}-scanner-service"
  }
  
  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.ecs_max_capacity
  min_capacity       = var.ecs_min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.scanner.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_queue_depth" {
  name               = "${local.name_prefix}-scanner-queue-depth-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value       = 10.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    
    customized_metric_specification {
      metrics {
        label = "Get the queue size (messages available)"
        id    = "m1"
        
        metric_stat {
          metric {
            namespace   = "AWS/SQS"
            metric_name = "ApproximateNumberOfMessagesVisible"
            
            dimensions {
              name  = "QueueName"
              value = aws_sqs_queue.scan_jobs.name
            }
          }
          
          stat = "Average"
        }
        
        return_data = false
      }
      
      metrics {
        label = "Get the running task count"
        id    = "m2"
        
        metric_stat {
          metric {
            namespace   = "ECS/ContainerInsights"
            metric_name = "RunningTaskCount"
            
            dimensions {
              name  = "ServiceName"
              value = aws_ecs_service.scanner.name
            }
            
            dimensions {
              name  = "ClusterName"
              value = aws_ecs_cluster.main.name
            }
          }
          
          stat = "Average"
        }
        
        return_data = false
      }
      
      metrics {
        label       = "Calculate messages per task"
        id          = "e1"
        expression  = "m1 / m2"
        return_data = true
      }
    }
  }
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "${local.name_prefix}-scanner-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace
  
  target_tracking_scaling_policy_configuration {
    target_value = 70.0
    
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

