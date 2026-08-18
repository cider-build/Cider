# DO NOT LET THIS MERGE INTO MAIN AT ANY COST


THIS FILE MUST BE DELETED BEFORE!

# After the backend foundation commit

- Move the complete `CiderApi` contract and wire schemas into a shared TypeScript package.
- Replace the frontend's manual API types and `request<T>` casts with the generated Effect HTTP client.
- Update the CLI to sign in through Better Auth and store the returned bearer session token.
- Remove the CLI calls to `/auth/cli/login` and `/auth/me`.
- Upgrade the backend and frontend to Better Auth 1.7 together.
- Add backend tests after the backend structure is stable.
- Add production limits for uploads, WebSocket buffers, response sizes, and snapshot storage.
- Decide when SQLite must move to a database that supports multiple backend instances.
