# KV namespaces (manifest §18.3). IDs flow to wrangler.jsonc via CI REPLACE_* injection.
resource "cloudflare_workers_kv_namespace" "flags" {
  account_id = var.account_id
  title      = "harborage-flags"
}

resource "cloudflare_workers_kv_namespace" "config" {
  account_id = var.account_id
  title      = "harborage-config"
}

resource "cloudflare_workers_kv_namespace" "i18n" {
  account_id = var.account_id
  title      = "harborage-i18n"
}

resource "cloudflare_workers_kv_namespace" "keydir_cache" {
  account_id = var.account_id
  title      = "harborage-keydir-cache"
}

resource "cloudflare_workers_kv_namespace" "rulesets" {
  account_id = var.account_id
  title      = "harborage-rulesets"
}
