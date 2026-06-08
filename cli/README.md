# Cider CLI

Barebones CLI for the local Cider backend.

## Config

Set the backend URL with:

```sh
export CIDER_API_URL=http://localhost:8000
```

Default: `http://localhost:8000`.

## Commands

```sh
cider nodes
cider nodes add <name> <url>
cider nodes delete <id>

cider sandboxes
cider sandboxes create [--node <id>]
cider sandboxes delete <id>
```

Examples:

```sh
cider nodes add local http://localhost:8001
cider sandboxes create
cider sandboxes delete cider-abc123
```
