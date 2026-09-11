# AKB Chat MCP

`tools/akb_chat_mcp.py` provides a small local MCP server for repeatable tests
of the deployed AKB Chat without browser automation. It calls the public AKB
web bridge, so the result passes through the same STRATOS access projection,
TLP and scope checks, RAG routing, conversation persistence and citation
authorization as a browser request.

The server exposes:

- `akb_health` for web health and readiness with latency;
- `akb_chat` for one real Chat turn;
- `akb_get_citation` for a fresh authorization of a returned citation;
- `akb_get_conversation` for authorization-filtered history;
- `akb_chat_evaluate` for a bounded set of up to 20 questions, optionally
  checking every returned citation. Acceptance runs can require at least one
  citation and restrict accepted response types, so an HTTP 200 `no_answer`
  cannot be mistaken for a successful grounded-answer test.

## Authentication

The preferred setup uses a dedicated public OIDC client named
`akb-chat-mcp-user`. It must use
Authorization Code with PKCE, issue the same `akl-api` and
`stratos-access-api` audiences and managed user claims as `akb-chat-web`, and
allow only this loopback redirect:

```text
http://127.0.0.1:18766/callback
```

Run the one-time device login:

```bash
python3 tools/akb_chat_mcp.py login --device
```

The device authorization request also uses PKCE S256. This keeps the client
compatible with the realm-wide PKCE policy while avoiding a browser-to-local
callback dependency.

The provisioning helper also installs the canonical STRATOS
`identity_audience` user-attribute mapper. Without that verified claim,
Access Center must reject the otherwise valid user token.

Creating or changing that client is an IAM operation and is intentionally not
performed by the MCP itself. Until the client is provisioned, use the
short-lived bearer-file mode below; it exercises the same AKB authorization
path and does not change central identity configuration.

An authorized operator can provision or reconcile the production client with
the idempotent helper below. It uses a unique, short-lived Keycloak bootstrap
service, verifies the persisted PKCE/device-flow settings and both required
audiences, and removes the bootstrap identity before it exits:

```bash
infra/keycloak/ensure-akb-chat-mcp-client.sh
```

The refresh token is stored outside the repository in
`~/.config/akb-chat-mcp/session.json` with mode `0600`. The MCP refreshes the
short-lived access token automatically. It never prints tokens or upstream
response bodies on authentication failures. The session can be revoked in the
central identity service and removed locally by deleting that single file.

For a short-lived diagnostic session, `AKB_CHAT_MCP_BEARER_TOKEN_FILE` may
instead point to a mode-`0600` file containing an access token.

The target defaults to `https://stratos.zeleznalady.cz/akb`; override it with
`AKB_CHAT_MCP_BASE_URL`. Only HTTPS is accepted.

## Codex registration

The local Codex MCP entry runs this file directly with Python and contains no
credential. Restart Codex after adding or changing the MCP entry. A successful
acceptance run first checks readiness, then runs `akb_chat_evaluate`, verifies
the cited chunks with `akb_get_citation`, and inspects the stored conversation.
