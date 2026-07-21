# Privileged console: separate hostname behind Cloudflare Access.
# Phishing-resistant only — no OTP of any kind. Admins authenticate through the
# GitHub IdP and must additionally present a hardware security key registered
# with Access (Independent MFA / auth_method "swk"). AAGUID restriction to
# project-issued authenticators is applied per RUNBOOK if/when the provider
# exposes it; the policy below enforces the hardware-key class.

resource "cloudflare_zero_trust_access_identity_provider" "github" {
  account_id = var.account_id
  name       = "GitHub (console admins)"
  type       = "github"
  config = {
    client_id     = var.github_idp_client_id
    client_secret = var.github_idp_client_secret
  }
}

resource "cloudflare_zero_trust_access_application" "console" {
  account_id                = var.account_id
  name                      = "Harborage console"
  domain                    = local.console_domain
  type                      = "self_hosted"
  session_duration          = "8h"
  auto_redirect_to_identity = true
  allowed_idps              = [cloudflare_zero_trust_access_identity_provider.github.id]
  app_launcher_visible      = false

  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.console_admins.id
      precedence = 1
    }
  ]

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_zero_trust_access_policy" "console_admins" {
  account_id = var.account_id
  name       = "console-admins-hardware-key"
  decision   = "allow"

  include = [
    for email in var.admin_emails : {
      email = { email = email }
    }
  ]

  require = [
    {
      auth_method = { auth_method = "swk" }
    }
  ]
}
