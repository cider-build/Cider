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
cider sandboxes exec <id> <command>
cider sandboxes snapshot <id>
cider sandboxes delete <id>

cider snapshots
cider snapshots restore <id>
cider snapshots delete <id>

cider open [path]
```

`cider open .` creates a tarball of the local path, creates a sandbox, and copies the folder into the guest under `/Users/admin/cider/<folder-name>`.

If the opened directory has a `cider.json`, the backend stores it as the sandbox launch config and runs it after upload:

```json
{
  "version": 1,
  "setup": ["npm install"],
  "start": "npm run dev"
}
```
