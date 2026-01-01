resource "aws_apigatewayv2_api" "main" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"
  description   = "S3 Scanner API"
  
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
    max_age       = 300
  }
  
  tags = {
    Name = "${local.name_prefix}-api"
  }
}

# API Gateway Stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
  
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }
  
  tags = {
    Name = "${local.name_prefix}-api-stage"
  }
}

# CloudWatch Log Group for API Gateway
resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = 7
  
  tags = {
    Name = "${local.name_prefix}-api-logs"
  }
}

# ========================================
# Lambda Integrations
# ========================================

# Integration: POST /scan
resource "aws_apigatewayv2_integration" "scan" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.scan.invoke_arn
  integration_method = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "scan" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /scan"
  target    = "integrations/${aws_apigatewayv2_integration.scan.id}"
}

resource "aws_lambda_permission" "scan" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scan.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Integration: GET /results
resource "aws_apigatewayv2_integration" "results" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.results.invoke_arn
  integration_method = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "results" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /results"
  target    = "integrations/${aws_apigatewayv2_integration.results.id}"
}

resource "aws_lambda_permission" "results" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.results.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Integration: GET /jobs/{job_id}
resource "aws_apigatewayv2_integration" "jobs" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.jobs.invoke_arn
  integration_method = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "jobs" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /jobs/{job_id}"
  target    = "integrations/${aws_apigatewayv2_integration.jobs.id}"
}

resource "aws_lambda_permission" "jobs" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.jobs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

