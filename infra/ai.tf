# AI Gateway: provisioned day-1, flag-gated OFF behind SpendCap + the degrade
# ladder (§18.1). Logging stays minimal by design — no prompt/response bodies.
resource "cloudflare_ai_gateway" "gw" {
  account_id                 = var.account_id
  id                         = "harborage-gw"
  collect_logs               = false
  cache_ttl                  = 0
  cache_invalidate_on_update = false
  rate_limiting_interval     = 60
  rate_limiting_limit        = 1000
  rate_limiting_technique    = "sliding"
}
