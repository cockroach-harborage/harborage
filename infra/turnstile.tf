# Turnstile widget for the document-intake path (§17.6, CLAUDE.md §5).
#
# MANAGED mode, deliberately, not Invisible. CLAUDE.md §5 records the corrected
# position: there is no Cloudflare setting that "tunes Turnstile to admit
# Tor/VPN" — no such control is documented and the official guidance points the
# other way. What actually helps a Tor or VPN user is widget-side, and Managed
# mode is the load-bearing part: a visitor who gets blocked sees an interactive
# challenge they can actually solve, instead of an invisible failure with no
# recovery path. Invisible mode would silently lock out exactly the people whose
# threat model forces them onto Tor.
#
# `feedback-enabled` is NOT set here: it is a client-side render option, and it
# is set to false where the widget is rendered (apps/web) so visitor feedback is
# never reported to Cloudflare.
#
# No prevent_destroy. Losing this widget is recoverable — recreate it and the
# deploy re-sets the secret — unlike the Email records or the Access application,
# where loss is catastrophic. tools/plan-guard still fails the build on any
# unintended destroy, which is the protection that matters here.
resource "cloudflare_turnstile_widget" "document_intake" {
  account_id = var.account_id
  name       = "harborage-document-intake"
  domains    = [var.zone_name]
  mode       = "managed"

  lifecycle {
    # The ~> 5.22 provider nulls server-defaulted optional attributes on
    # re-apply and the API rejects a null bool, which breaks every deploy after
    # the first. Every optional+computed attribute on this resource has to be
    # ignored for that reason — the same fix already applied to
    # cloudflare_ai_gateway and cloudflare_d1_database.
    ignore_changes = [bot_fight_mode, clearance_level, ephemeral_id, offlabel, region]
  }
}
