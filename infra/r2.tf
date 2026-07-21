# Three content buckets (§18.1: no 4th archive bucket; harborage-tfstate is
# bootstrap-created, outside this state). Bucket Locks are counsel-gated (§16)
# and NOT configured here yet.
#
# CORS exposing ETag on the two upload buckets is a named M0 deliverable (§19):
# without it, browser JS cannot read UploadPart ETags and every resumable
# multipart upload is uncompletable.

resource "cloudflare_r2_bucket" "evidence_vault" {
  account_id = var.account_id
  name       = "harborage-evidence-vault"
  location   = "APAC"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "public_media" {
  account_id = var.account_id
  name       = "harborage-public-media"
  location   = "APAC"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "knowledge" {
  account_id = var.account_id
  name       = "harborage-knowledge"
  location   = "APAC"

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  upload_cors_rules = [
    {
      allowed = {
        origins = ["https://${var.zone_name}"]
        methods = ["PUT", "POST", "GET", "HEAD"]
        headers = ["content-type", "content-length"]
      }
      expose_headers  = ["ETag"]
      max_age_seconds = 3600
    }
  ]
}

resource "cloudflare_r2_bucket_cors" "evidence_vault" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.evidence_vault.name
  rules       = local.upload_cors_rules
}

resource "cloudflare_r2_bucket_cors" "public_media" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.public_media.name
  rules       = local.upload_cors_rules
}

# ~30-day incomplete-multipart lifecycle (vs the 7-day default) so a
# multi-session 2G upload has honest room — bounded, not infinite (§19).
resource "cloudflare_r2_bucket_lifecycle" "evidence_vault" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.evidence_vault.name
  rules = [
    {
      id      = "abort-incomplete-multipart-30d"
      enabled = true
      conditions = {
        prefix = ""
      }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 2592000
        }
      }
    }
  ]
}
