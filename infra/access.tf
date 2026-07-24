# Privileged console: separate hostname behind Cloudflare Access.
#
# MFA enforcement (verified 2026-07-25): the real phishing-resistant control is
# ORG-LEVEL Access Independent MFA — `allowed_authenticators = ["security_key",
# "biometrics"]` (both WebAuthn), `required_aaguids` restricted to ceremony
# hardware, AMR-matching OFF. Those live on the Zero Trust *organization*
# (`PUT /accounts/{id}/access/organizations` → `mfa_config`), NOT on this app
# resource, and AAGUID pinning needs real hardware AAGUIDs from the offline key
# ceremony. They are therefore a RUNBOOK manual step (org-scoped + hardware-
# dependent), reconciled and tested when the maintainer configures org MFA.
# Security-key-*only* is NOT enforceable (TOTP cannot be excluded at org level).
#
# The policy `require` below asks the IdP to assert an MFA auth method via the
# RFC 8176 `amr` claim. Caveat to reconcile at the org-MFA step: the GitHub IdP
# does not assert WebAuthn AMR, and `swk` is RFC 8176 *software*-secured key
# (hardware is `hwk`), so this `require` is a belt-and-braces IdP signal, not the
# load-bearing control — org-level Independent MFA is. Left functionally
# unchanged here (a live Access-policy change is a RUNBOOK §7 human-gated event).

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
