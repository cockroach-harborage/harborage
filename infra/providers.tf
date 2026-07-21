# State lives in R2 (s3 backend); backend.hcl is rendered by scripts/bootstrap.sh
# locally and inline in CI. It is gitignored — see backend.hcl.example.
terraform {
  required_version = ">= 1.12"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"
    }
  }

  backend "s3" {}
}

# Auth: CLOUDFLARE_API_TOKEN env var (HB_TERRAFORM_TOKEN in the CI infra job).
provider "cloudflare" {}
