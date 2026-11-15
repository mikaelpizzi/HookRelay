variable "project_name" {
  description = "Nombre del proyecto para tags y recursos"
  type        = string
  default     = "hookrelay"
}

variable "aws_region" {
  description = "Región de AWS"
  type        = string
  default     = "us-east-1"
}

variable "app_port" {
  description = "Puerto de la aplicación NestJS"
  type        = number
  default     = 3000
}

variable "db_instance_class" {
  description = "Clase de instancia RDS"
  type        = string
  default     = "db.t3.micro"
}

variable "redis_node_type" {
  description = "Tipo de nodo ElastiCache Redis"
  type        = string
  default     = "cache.t3.micro"
}

variable "app_cpu" {
  description = "CPU units para tareas ECS Fargate"
  type        = number
  default     = 256
}

variable "app_memory" {
  description = "Memoria (MiB) para tareas ECS Fargate"
  type        = number
  default     = 512
}
