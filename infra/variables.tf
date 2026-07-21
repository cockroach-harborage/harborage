variable "account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "zone_name" {
  description = "Production zone (apex). Supplied via terraform.tfvars; never hardcoded."
  type        = string
}

variable "admin_emails" {
  description = "Console admins (Access policy include). Sourced from the ADMIN_HANDLES GitHub variable."
  type        = list(string)
  default     = []
}

variable "github_idp_client_id" {
  description = "GitHub OAuth app client ID for the Access identity provider."
  type        = string
  default     = ""
}

variable "github_idp_client_secret" {
  description = "GitHub OAuth app client secret for the Access identity provider."
  type        = string
  default     = ""
  sensitive   = true
}
