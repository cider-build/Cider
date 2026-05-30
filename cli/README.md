# cider CLI

Command-line interface for [cider.build](https://cider.build) sandboxes.

## Install (local dev)

From this directory:

```sh
npm install
npm link        # exposes the `cider` binary globally
```

`npm link` symlinks `bin/cider.js` into your global npm prefix, so `cider` is
on your `$PATH` and tracks any edits you make in this checkout. Run
`npm run unlink` to undo it.

If you'd rather not link, you can run the CLI directly with
`node bin/cider.js <command>`.

## Configuration

| Env var          | Default                  | Notes                          |
| ---------------- | ------------------------ | ------------------------------ |
| `CIDER_API_URL`  | `http://localhost:8000`  | FastAPI backend                |
| `CIDER_WEB_URL`  | `http://localhost:3000`  | React dashboard                |

The token returned by `cider login` is written to `~/.cider/config.json` with
`0600` perms. Override at any time by re-running `cider login --api-url …
--web-url …`.

## Commands

### `cider login`

Opens your browser to `<web-url>/cli-auth?port=…&state=…`. The dashboard mints
a token tied to your session and redirects to `http://127.0.0.1:<port>/callback`,
which the CLI captures and stores.

### `cider logout`

Revokes the stored token on the server and removes `~/.cider/config.json`.

### `cider whoami`

Prints the signed-in user, org, and current API URL.

### `cider open [path]`

Creates or reopens the sandbox linked to a local path, mounts that path into the
VM, opens Terminal at the mounted directory, and launches Screen Sharing.

- Directories are mounted at `/Volumes/My Shared Files/cider` in the VM.
- Files mount their parent directory and open Terminal at that guest mount.
- First run for a path: picks a healthy compute node, calls `POST /sandboxes`,
  writes `<mounted-dir>/.cider/sandbox.json`, and opens Screen Sharing through a
  local VNC auth shim.
- Subsequent runs: reads `<mounted-dir>/.cider/sandbox.json` and reuses the
  existing running sandbox when it was created for that same path.

Flags:

- `--node <id>` — pin to a specific compute node
- `--fresh` — ignore the link file and create a new sandbox
- `--no-open` — open Terminal in the VM without launching Screen Sharing
