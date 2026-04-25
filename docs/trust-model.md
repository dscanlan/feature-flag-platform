# Trust model

This document explains who is trusted to assert what, and what the resolver
does to enforce it. It mirrors PLAN.md §7.6 and is the canonical reference for
the contracts shipped in Phase 9.

## TL;DR

- **Browser-resolved flag values are UX inputs, not authorization.** A
  determined user can always change the value in their devtools after the
  resolver returns it.
- For non-sensitive flags (UI fork, copy variants), the SDK can send raw
  subject attributes and the resolver will trust them. This is "lower-trust
  mode".
- For sensitive flags (gates that protect features tied to billing, internal
  permissions, etc.) the **host application's backend signs a `subjectToken`**
  carrying the trusted subject claims. The browser SDK forwards that opaque
  token to the resolver, which verifies it before evaluation. This is
  "trusted-subject mode".
- The SSE channel is gated by a separate **`streamToken`** issued from
  `/sdk/resolve`, bound to `(stage, subject, exp)`, so streams scope to the
  exact subject they were resolved for.

## What this prevents

| Threat                                                        | Prevented?                     |
| ------------------------------------------------------------- | ------------------------------ |
| Tampering with the resolve response in transit                | TLS                            |
| Subscribing to a stream you don't have a key for              | Yes                            |
| Casual subject forgery from the browser (with `subjectToken`) | Yes                            |
| End user editing a flag value in their browser after delivery | **No**                         |
| End user replaying a previously valid `subjectToken`          | Until expiry — keep TTLs short |

Anything that has to be enforced — billing, authorization, paywalls — must
still be re-checked server-side by the host application. Browser flags are
input to the UX layer only.

## Tokens at a glance

Both tokens share the wire format `prefix-<base64url(payload)>.<base64url(hmac)>`,
HMAC-SHA256.

### `sjt-` — Subject Token (issued by host app's backend)

```ts
{
  sub: Subject,    // the subject claims you trust the browser to use
  exp: number,     // seconds since epoch
  iat?: number     // optional issued-at
}
```

Signed with the **per-stage `subject_signing_secret`** stored on
`stages.subject_signing_secret`. The admin retrieves the secret on stage
create or via the rotate endpoint, hands it to backend infrastructure, and
that backend signs tokens for authenticated browser sessions.

The resolver:

1. Verifies the signature against the stage's secret.
2. Rejects if the signature is wrong (`401 BAD_SUBJECT_TOKEN`).
3. Rejects if `exp <= now` (also `401 BAD_SUBJECT_TOKEN`).
4. Validates the embedded `sub` against the same schema raw subjects use; bad
   shape → `400 MALFORMED_SUBJECT`.
5. Uses the verified subject for resolution. Persists the subject as if it
   had been sent raw.

If both `subject` and `subjectToken` are present in the request body, the
**token wins** — its claims are the trusted ones.

### `sst-` — Stream Subscription Token (issued by the resolver)

```ts
{
  s: string,       // stage UUID
  f: string,       // 22-char subject fingerprint (HMAC of canonical key)
  exp: number      // seconds since epoch (default 5 minutes)
}
```

Signed with the resolver's `STREAM_TOKEN_SECRET` (env var, must be the same
across all resolver tasks behind the same ALB). Returned in
`POST /sdk/resolve` as `streamToken`, valid for `STREAM_TOKEN_TTL_SEC`
seconds (default 300, range 30–3600).

The resolver verifies the token on `/sdk/stream`. The token is opaque to the
client.

For back-compat, `/sdk/stream` still accepts `pub-` and `srv-` keys directly —
this is what server-mode SDKs use, and it's the path existing client-mode
SDKs took before Phase 9. New client-mode SDKs (≥ 0.2.0) prefer the
`sst-` token automatically once the resolver issues one.

## Where to set what

| Setting                                 | Where           | Notes                                     |
| --------------------------------------- | --------------- | ----------------------------------------- |
| `STREAM_TOKEN_SECRET` (32+ char string) | resolver env    | Required in prod; dev auto-generates one  |
| `STREAM_TOKEN_TTL_SEC` (30 ≤ n ≤ 3600)  | resolver env    | Default 300                               |
| `subject_signing_secret`                | per-stage in DB | Auto-generated on stage create; rotatable |

## Recommended flow for sensitive flags

1. The user authenticates with your backend.
2. Your backend constructs a `Subject` describing the trusted claims (e.g.
   `{ type: "user", id, plan, tier }`) and signs a `subjectToken` with the
   stage's `subject_signing_secret`. Use a short `exp` (1–5 min).
3. The browser receives the `subjectToken` and passes it to the SDK:

   ```ts
   const client = createClient({
     baseUrl: "https://flags.example.com",
     publicKey: "pub-…",
     subject: { type: "user", id }, // local-only — for display
     subjectToken: signedFromBackend,
   });
   ```

4. When the user's session refreshes, your backend re-signs and the browser
   calls `client.setSubjectToken(newToken)`. The SDK refetches with the new
   token and reconnects SSE with the freshly issued stream token.

## What this is _not_

- It is not an authorization system. Use it to switch UX, not to gate
  capabilities.
- It is not a replacement for server-side checks. Anything you actually need
  to enforce should be re-resolved server-side using the server-mode SDK
  (`createServerClient`) or your own resolver call against an `srv-` key.

See PLAN.md §7.6 for the original specification.
