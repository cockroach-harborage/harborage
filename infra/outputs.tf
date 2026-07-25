# Consumed by CI (deploy job: `tofu output -raw` + REPLACE_* injection into
# wrangler.jsonc). Never hardcode these IDs anywhere.
output "zone_id" {
  value = local.zone_id
}

output "console_domain" {
  value = local.console_domain
}

output "kv_flags_id" {
  value = cloudflare_workers_kv_namespace.flags.id
}

output "kv_config_id" {
  value = cloudflare_workers_kv_namespace.config.id
}

output "kv_i18n_id" {
  value = cloudflare_workers_kv_namespace.i18n.id
}

output "kv_keydir_cache_id" {
  value = cloudflare_workers_kv_namespace.keydir_cache.id
}

output "kv_rulesets_id" {
  value = cloudflare_workers_kv_namespace.rulesets.id
}

output "d1_harborage_id" {
  value = cloudflare_d1_database.harborage.id
}

output "access_console_aud" {
  value     = cloudflare_zero_trust_access_application.console.aud
  sensitive = true
}

# Public by design: the sitekey is embedded in the page. Flows to the api Worker
# as a var, and reaches the client through GET /api/intake/status alongside the
# intake public key, so no prerendered page needs a build-time substitution.
output "turnstile_sitekey" {
  value       = cloudflare_turnstile_widget.document_intake.sitekey
  description = "Turnstile sitekey for the document-intake widget."
}

# The verification secret. Marked sensitive so it is never printed in a log or a
# plan summary; the deploy job pipes it straight into `wrangler secret put`.
output "turnstile_secret" {
  value       = cloudflare_turnstile_widget.document_intake.secret
  description = "Turnstile secret for siteverify."
  sensitive   = true
}
