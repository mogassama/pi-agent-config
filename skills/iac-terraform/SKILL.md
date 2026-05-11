---
name: iac-terraform
description: Load for Terraform IaC on GCP — writing, reviewing, or modifying HCL for BigQuery, GCS, IAM, Cloud Run, Cloud Functions, Pub/Sub, Composer. Auto-load on .tf files, terraform commands, or GCP infrastructure provisioning tasks.
---

# IaC — Terraform GCP

## Non-negotiable rules

- Remote backend in GCS — never local state. Every config starts with this block.
- `terraform fmt` before any commit. `terraform validate` before any plan.
- `terraform plan` output reviewed before every `apply`. Destructions require explicit operator confirmation.
- `prevent_destroy = true` on all stateful resources (BQ datasets, GCS buckets, Composer environments).
- Least-privilege IAM — never `roles/owner`, `roles/editor`, or `roles/viewer` on production resources.
- All resource descriptions, variable descriptions, and comments in English.

## Project structure

```
infra/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       ├── variables.tf
│       └── terraform.tfvars
├── modules/
│   ├── bigquery/
│   ├── gcs/
│   └── iam/
└── backend.tf   # shared backend config reference
```

Separate directories per environment — not Terraform workspaces. Workspaces share state backend config and are error-prone for environment isolation.

## Backend (mandatory)

```hcl
terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "my-project-tfstate"
    prefix = "infra/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
```

## Variables — canonical pattern

```hcl
variable "project_id" {
  type        = string
  description = "GCP project ID."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID."
  }
}

variable "region" {
  type        = string
  description = "GCP region for all resources."
  default     = "europe-west1"
}

variable "env" {
  type        = string
  description = "Environment name (dev, staging, prod)."
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of: dev, staging, prod."
  }
}
```

Every variable needs `type` and `description`. Use `validation` blocks for format constraints.

## Naming convention

Format: `{env}-{service}-{name}` — short, readable, GCS-safe.

Examples:
- GCS bucket: `prod-data-raw-orders` (≤63 chars — GCS limit)
- BQ dataset: `prod_orders_raw` (snake_case — BQ convention)
- Service account: `prod-composer-runner@project.iam.gserviceaccount.com`

## Standard labels

```hcl
locals {
  common_labels = {
    env          = var.env
    team         = "data"
    cost_center  = var.cost_center
    managed_by   = "terraform"   # not "pi-agent" — standard convention for billing exports
  }
}
```

## Core resource patterns

### GCS bucket

```hcl
resource "google_storage_bucket" "data_lake" {
  name          = "${var.env}-data-raw-${var.name}"
  location      = var.region
  storage_class = "STANDARD"
  force_destroy = false

  labels = local.common_labels

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
    condition {
      age = 90
    }
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
```

### BigQuery dataset

```hcl
resource "google_bigquery_dataset" "raw" {
  dataset_id                  = "${var.env}_orders_raw"
  location                    = var.region
  description                 = "Raw ingestion layer for orders pipeline."
  delete_contents_on_destroy  = false

  labels = local.common_labels

  lifecycle {
    prevent_destroy = true
  }
}
```

### BigQuery table with partitioning

```hcl
resource "google_bigquery_table" "orders" {
  dataset_id = google_bigquery_dataset.raw.dataset_id
  table_id   = "orders"
  description = "Raw orders from the e-commerce platform."

  labels = local.common_labels

  time_partitioning {
    type  = "DAY"
    field = "event_date"
  }

  clustering = ["country", "product_id"]

  schema = file("${path.module}/schemas/orders.json")

  lifecycle {
    prevent_destroy = true
  }
}
```

### IAM — member vs binding

```hcl
# google_project_iam_member — ADDITIVE (safe, use this by default)
# Adds a single binding without affecting existing ones
resource "google_project_iam_member" "composer_bq_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.composer_runner.email}"
}

# google_project_iam_binding — AUTHORITATIVE (dangerous)
# Replaces ALL existing bindings for this role — removes humans if they had it
# Only use when you own the full binding definition for that role
resource "google_project_iam_binding" "bq_admin_exclusive" {
  project = var.project_id
  role    = "roles/bigquery.admin"
  members = [
    "serviceAccount:${google_service_account.pipeline_admin.email}",
  ]
}
```

**Rule:** Use `google_project_iam_member` by default. Use `google_project_iam_binding` only when you explicitly own all members for that role and want to enforce no others have it.

### Service account

```hcl
resource "google_service_account" "composer_runner" {
  account_id   = "${var.env}-composer-runner"
  display_name = "Composer Runner — ${var.env}"
  description  = "Service account for Cloud Composer DAG execution."
  project      = var.project_id
}

resource "google_project_iam_member" "composer_runner_bq_job" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.composer_runner.email}"
}
```

## Plan review — what to check

Before approving any `terraform apply`:

```
# Resources to destroy — mandatory review
- [ ] No stateful resource destroyed (BQ dataset/table, GCS bucket, Composer env, SA)
- [ ] `prevent_destroy` lifecycle is present on all stateful resources
- [ ] IAM binding changes don't remove existing human or service account access unexpectedly

# Resources to create
- [ ] Labels present on all new resources
- [ ] No hardcoded project IDs or credentials in resource configs
- [ ] Region matches europe-west1 unless explicitly justified

# Plan flags — immediate escalation
- Forces replacement (~ → -/+): review impact carefully
- Destroys > 0 stateful resources: do not apply without operator confirmation
```

## Anti-patterns

- Local state (`terraform.tfstate` in the repo) — always use GCS backend
- `google_project_iam_binding` for shared roles — use `_member` instead
- Hardcoded project IDs or regions in resource blocks — always use variables
- No `prevent_destroy` on BQ datasets, GCS buckets, or Composer environments
- `force_destroy = true` on production buckets — data loss risk
- `delete_contents_on_destroy = true` on production BQ datasets
- Labels missing `managed_by = "terraform"` — breaks cost attribution
- Workspaces for environment isolation — use separate directories

## Review checklist

- [ ] GCS remote backend configured with project-specific prefix
- [ ] `terraform fmt` applied — no formatting issues
- [ ] Every variable has `type` and `description`
- [ ] `validation` block on project_id, env, and region variables
- [ ] `prevent_destroy = true` on all stateful resources
- [ ] `google_project_iam_member` used (not `_binding`) for additive grants
- [ ] No `roles/owner` or `roles/editor` granted
- [ ] Labels include `env`, `team`, `cost_center`, `managed_by = "terraform"`
- [ ] GCS buckets have lifecycle rules (Coldline transition + Delete)
- [ ] BQ tables have `time_partitioning` and `clustering` where applicable
- [ ] Plan output reviewed — zero unexpected destructions
