# Queues provisioned day-1 (manifest §18.3); consumers attach at M2/M4.
# A DLQ is mandatory on every consumer or poison messages are silently dropped.
resource "cloudflare_queue" "moderation_bulk" {
  account_id = var.account_id
  queue_name = "moderation-bulk"
}

resource "cloudflare_queue" "moderation_bulk_dlq" {
  account_id = var.account_id
  queue_name = "moderation-bulk-dlq"
}

resource "cloudflare_queue" "life_safety" {
  account_id = var.account_id
  queue_name = "life-safety"
}

resource "cloudflare_queue" "life_safety_dlq" {
  account_id = var.account_id
  queue_name = "life-safety-dlq"
}
