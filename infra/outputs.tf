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
