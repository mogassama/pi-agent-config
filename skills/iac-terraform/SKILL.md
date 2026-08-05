---
name: iac-terraform
description: >-
  Load for .tf and .tfvars files and terraform commands — HCL authoring and
  review, module structure, variable and output design, state and backend
  handling, plan/apply discipline, drift. Territory-scoped by file extension:
  infrastructure declared as code and reconciled against state. A one-off
  imperative operation on the same resource is not this skill.

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

## Anti-patterns

The non-negotiable rules above state what to do; these are the shapes that
break them in practice, and they are not restated in the severity table — that
table weighs them.

- `terraform.tfstate` committed to the repository
- `google_project_iam_binding` where `_member` was meant — the binding is
  authoritative and silently removes grants it does not list
- Hardcoded project IDs or regions inside resource blocks
- `force_destroy = true` on a production bucket
- `delete_contents_on_destroy = true` on a production BigQuery dataset
- Labels missing `managed_by = "terraform"` — breaks cost attribution
- Workspaces used for environment isolation instead of separate directories

## Review delta

*Everything above is authoring guidance, injected for both worker and reviewer.
This section is injected for the reviewer only. It replaces the former
`## Plan review` and `## Review checklist` — two unweighted lists that, with the
`code-review` Terraform block, made three parallel checklists for one domain.*

**Floor.** For a diff under ~10 lines, report only HIGH findings. A label added
to an already-conformant resource does not warrant a posture review.

### Review the plan, not the diff

This is the one rule that separates Terraform review from every other review
in this repo. **A `.tf` diff does not show what will happen.** A three-line
change to a variable default can force the replacement of a BigQuery dataset.
Ask for `terraform plan` output; if it is not available, say so in
`open_risks` and cap the verdict at `needs_rework`.

Escalate on the plan output, regardless of how small the diff is:

- **Forces replacement** (`~` becoming `-/+`) on any resource holding state —
  **HIGH**. The resource is destroyed and recreated; the data does not follow.
- **Destroy count above zero** on a stateful resource — BigQuery dataset or
  table, GCS bucket, Composer environment, service account — **HIGH**, and
  `blocked` unless the task text names the destruction as intended.
- **IAM binding change that removes an existing grant** — MEDIUM, HIGH when the
  grant belongs to a service account a running pipeline uses.

### Severity assignment

Definitions live in `code-review`. Which IAM roles are forbidden is stated in
`gcp-engineering` — this table weighs the Terraform expression of a binding,
not the choice of role.

| Breach | Severity |
|:--|:--|
| Hardcoded project ID or credential in a `.tf` file | **HIGH** |
| `force_destroy = true` on a production bucket | **HIGH** |
| `delete_contents_on_destroy = true` on a production BigQuery dataset | **HIGH** |
| IAM binding to `allUsers` or `allAuthenticatedUsers` | **HIGH** |
| `prevent_destroy` absent on a stateful resource | MEDIUM |
| No remote backend — state local or in the repository | MEDIUM, **HIGH** if the state file is committed and contains a secret |
| `google_project_iam_binding` used for an additive grant where `_member` applies | MEDIUM |
| Workspaces used for environment isolation instead of separate directories | MEDIUM |
| GCS bucket with no lifecycle rule | MEDIUM |
| Variable with no `type` or `description` | LOW |
| No `validation` block on `project_id`, `env` or `region` | LOW |
| `terraform fmt` not applied | LOW |
| Labels missing `env`, `team`, `cost_center` or `managed_by = "terraform"` | LOW |
| BigQuery table without `time_partitioning` or `clustering` where applicable | LOW |

### Traps a diff does not show

- **`prevent_destroy` present but the resource renamed.** Renaming the block
  address destroys and recreates: the lifecycle guard protects the old address,
  which no longer exists in the configuration. A rename reads as a cosmetic
  diff and is the most common way stateful data is lost.
- **A `count` or `for_each` whose key set changed.** Reordering a list
  reindexes every resource after the change. The diff shows one added entry;
  the plan shows a cascade of replacements.
- **A module version bump.** The diff is one line. What it pulls in is not
  visible without reading the module's own changelog.
- **A variable default changed in `variables.tf`** while the environment
  `.tfvars` still overrides it — no effect at all, and a finding raised on it
  is a false positive. Check the override before reporting.

### Verdict

`blocked` requires at least one HIGH at `certain` or `probable`, **or** any
unintended destruction of a stateful resource in the plan. A HIGH at `possible`
downgrades to `needs_rework` and must be named in `top_priority`. With no
finding above LOW and a clean plan, `approved`.
