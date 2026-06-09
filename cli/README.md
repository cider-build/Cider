# Cider CLI

Barebones CLI for the local Cider backend.

Set backend URL:

```sh
export CIDER_API_URL=http://localhost:8000
```

Commands:

```sh
cider nodes
cider nodes add <name> <url>
cider nodes delete <id>

cider sandboxes
cider sandboxes create
cider sandboxes delete <id>

cider open [path]
```

`cider open .` creates a tarball of the local path, creates a sandbox, and copies the files into the guest at `/Users/admin/cider`.
