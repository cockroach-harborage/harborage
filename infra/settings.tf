# Zone-wide TLS/security baseline. Volumetric L7 DDoS relies on Cloudflare's
# managed/unmetered rulesets (automatic); WAF custom-characteristic rate limiting
# is unavailable on this plan — the RateLimit DO is the app-layer substitute
# (ARCHITECTURE §17.6). Never rate-limit reading public safety info.
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = local.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls" {
  zone_id    = local.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls13" {
  zone_id    = local.zone_id
  setting_id = "tls_1_3"
  value      = "on"
}
