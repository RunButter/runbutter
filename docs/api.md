# REST API & MCP

One executor serves both, so an external tool and an in-app agent take the
identical, tenancy-safe path.

## Keys

**Settings → Integrations → API keys.** A key looks like `hb_…` and is shown
once. Each key has a **scope**: `read` or `write`.

Two rules bound where a key can be used, and they are enforced independently:

- A key sent in the **query string** must be scope `read`, or the request is 401.
- A key sent in the query string can **never write**, whatever its scope — POST
  returns 403.

The transport is what is untrusted, not just the credential: query strings end
up in browser history, proxy logs and shared spreadsheets.

The same scope is enforced on `/api/mcp`, or a read-only key could simply write
there instead.

## REST

### List records

```bash
curl -H "Authorization: Bearer hb_..." \
  "https://your-domain.com/api/v1/records?object=companies"
```

```json
{ "object": "companies", "count": 2, "data": [ { "id": "…", "name": "Northwind Freight", "domain": "northwind.example" } ] }
```

`object` accepts any built-in slug (`companies`, `people`, `invoices`,
`expenses`, `transactions`, `products`, `campaigns`, `projects`, `issues`,
`assets`, …) **and any custom object slug** — they go through the same five
functions, so nothing special is needed to expose one.

### Create a record

```bash
curl -X POST -H "Authorization: Bearer hb_..." -H "content-type: application/json" \
  -d '{"object":"companies","data":{"name":"Vertex Robotics","domain":"vertex.example"}}' \
  "https://your-domain.com/api/v1/records"
```

Requires a `write` key in the **Authorization header**.

### CSV, for spreadsheets

```
https://your-domain.com/api/v1/records?object=invoices&format=csv&key=hb_...
```

Built for Excel's *Data → Get Data → From Web*, which cannot send an
Authorization header from its dialog — hence the query-string key, and hence the
two rules above. The CSV carries a UTF-8 BOM (without it Excel mangles non-ASCII
names) and CRLF line endings, and its columns are the union of every row's keys
in first-seen order.

## MCP

```json
{
  "mcpServers": {
    "runbutter": {
      "type": "http",
      "url": "https://your-domain.com/api/mcp",
      "headers": { "Authorization": "Bearer hb_..." }
    }
  }
}
```

Works with Claude Desktop, Claude Code, Cursor, or anything else that speaks the
protocol. `/.well-known/mcp.json` describes the server and is **generated from
the tool catalogue**, never hand-written.

The tools are the same ones an in-app agent gets — records, finance, files,
compliance screening, hiring, analytics, connections. The full list, with the
writing ones marked, is in [Agents](./agents.md).

## Webhooks

**Incoming:** Automate → a webhook trigger gives you a URL to POST to; the body
is available to the rest of the rule.

**Outgoing:** automations and the `call_connection` agent tool both send signed
requests and log every delivery. Outbound URLs pass an SSRF guard —
`169.254.169.254` and friends are refused even when an owner saved them, because
an owner-saved URL is not automatically a safe one.

## Rate limits and sizes

Public endpoints are rate-limited per IP and body-capped. A limited request
returns 429 with `Retry-After`. These are per-instance defaults in
`lib/security/http.ts`; self-hosters can change them.
