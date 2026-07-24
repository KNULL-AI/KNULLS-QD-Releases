# Trigger Worker Deploy + First Admin Bootstrap

## 1) Configure secrets

Set a one-time bootstrap secret and any other required secrets:

```powershell
npx wrangler secret put BOOTSTRAP_ADMIN_SECRET
```

Optional:

```powershell
npx wrangler secret put DISCORD_BOT_TOKEN
```

## 2) Run D1 schema migration

```powershell
npm run cf:d1:migrate
```

## 3) Deploy worker

```powershell
npm run cf:deploy
```

## 4) Bootstrap first admin key (one-time)

Replace `<worker-url>` with your deployed Worker URL.

```powershell
$secret = Read-Host "Enter BOOTSTRAP_ADMIN_SECRET"
$body = @{ label = "primary-admin"; owner_ref = "owner" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "<worker-url>/v1/admin/bootstrap" -Headers @{ Authorization = "Bearer $secret"; "Content-Type" = "application/json" } -Body $body
```

Expected response includes one plaintext admin key:

```json
{
  "ok": true,
  "id": "...",
  "key": "KNULL-ADM-...",
  "key_type": "admin"
}
```

Store that key securely. It is not recoverable later.

## 5) Lock down bootstrap path after success

After creating your first admin key, rotate or remove `BOOTSTRAP_ADMIN_SECRET`:

```powershell
npx wrangler secret put BOOTSTRAP_ADMIN_SECRET
```

Set it to a new random value and do not use `/v1/admin/bootstrap` again.

## 6) Create user keys via admin API

1. Exchange admin key for admin token:

```http
POST /v1/admin/login
{ "key": "KNULL-ADM-..." }
```

2. Create user key:

```http
POST /v1/admin/keys
Authorization: Bearer <admin-access-token>
{
  "key_type": "user",
  "owner_ref": "customer-001",
  "label": "customer-001 key",
  "max_devices": 1,
  "expires_in_days": 30
}
```
