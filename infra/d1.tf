# Single D1 database (manifest §18.3). Tables ship with feature migrations
# (forward-only, expand → deploy → contract; migrations/ + migrations/inverse/).
resource "cloudflare_d1_database" "harborage" {
  account_id = var.account_id
  name       = "harborage"

  lifecycle {
    prevent_destroy = true
  }
}
