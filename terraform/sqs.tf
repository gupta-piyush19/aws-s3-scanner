
resource "aws_sqs_queue" "dlq" {
  name = "${local.name_prefix}-scan-jobs-dlq"
  
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = var.sqs_visibility_timeout
  
  # Enable encryption at rest
  sqs_managed_sse_enabled = true
  
  tags = {
    Name = "${local.name_prefix}-scan-jobs-dlq"
  }
}

# Main Queue
resource "aws_sqs_queue" "scan_jobs" {
  name = "${local.name_prefix}-scan-jobs"
  
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = var.sqs_visibility_timeout
  receive_wait_time_seconds  = 20
  
  sqs_managed_sse_enabled = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })
  
  tags = {
    Name = "${local.name_prefix}-scan-jobs"
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_depth" {
  alarm_name          = "${local.name_prefix}-high-queue-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Average"
  threshold           = 1000
  alarm_description   = "Alert when SQS queue depth is high"
  treat_missing_data  = "notBreaching"
  
  dimensions = {
    QueueName = aws_sqs_queue.scan_jobs.name
  }
  
  tags = {
    Name = "${local.name_prefix}-queue-depth-alarm"
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${local.name_prefix}-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Alert when messages appear in DLQ"
  treat_missing_data  = "notBreaching"
  
  dimensions = {
    QueueName = aws_sqs_queue.dlq.name
  }
  
  tags = {
    Name = "${local.name_prefix}-dlq-alarm"
  }
}

