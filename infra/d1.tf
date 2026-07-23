# Single D1 database (manifest §18.3). Tables ship with feature migrations
# (forward-only, expand → deploy → contract; migrations/ + migrations/inverse/).
resource "cloudflare_d1_database" "harborage" {
  account_id = var.account_id
  name       = "harborage"

  lifecycle {
    prevent_destroy = true
    # Provider ~> 5.22 nulls read_replication on re-apply (API rejects it). D1
    # stays single-region ("disabled") by default; we do not manage this attr.
    ignore_changes = [read_replication]
  }
}
