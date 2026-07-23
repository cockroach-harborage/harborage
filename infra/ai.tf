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

  # Provider ~> 5.22 cannot cleanly diff this resource: it stores server-defaulted
  # optional attrs as null and re-applies them (the API rejects null booleans and
  # null objects), and computed attrs (otel/spend_limits/timestamps) force a
  # perpetual update-in-place. The gateway is create-once (config is stable and
  # M0-flag-OFF), so manage creation and ignore all post-create drift. A deliberate
  # config change would be applied via -replace.
  lifecycle {
    ignore_changes = all
  }
}
