# The zone is added to the account manually (RUNBOOK Part A step 0) — registrar
# nameserver changes cannot be IaC. Everything on the zone is managed here,
# except Worker hostnames, which Wrangler owns (one writer per resource).
data "cloudflare_zone" "main" {
  filter = {
    name = var.zone_name
  }
}

locals {
  zone_id        = data.cloudflare_zone.main.zone_id
  console_domain = "console.${var.zone_name}"
}

# This domain sends no email. Null SPF + reject-all DMARC stop spoofing of the
# project's name (impersonation is a named threat). If operator email is ever
# provisioned, these change in the same PR that adds email.tf (prevent_destroy there).
resource "cloudflare_dns_record" "spf_null" {
  zone_id = local.zone_id
  name    = var.zone_name
  type    = "TXT"
  content = "\"v=spf1 -all\""
  ttl     = 3600
}

resource "cloudflare_dns_record" "dmarc_reject" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.zone_name}"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s\""
  ttl     = 3600
}
