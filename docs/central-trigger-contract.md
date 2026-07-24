# Central Trigger Bus Contract (MVP)

## Key Types

- `user` keys: may call activation endpoints only.
- `admin` keys: may call admin endpoints only.
- Backend must reject `admin` keys on `/v1/activate`.

## Activation

### `POST /v1/activate`
Request:
```json
{
  "key": "KNULL-XXXX-XXXX-XXXX",
  "device_id": "device-123",
  "app_version": "1.0.4"
}
```

Response:
```json
{
  "access_token": "jwt-or-random-token",
  "refresh_token": "refresh-token",
  "user_id": "user_abc",
  "key_id": "key_123",
  "ws_url": "wss://bus.example.com/v1/triggers",
  "expires_in": 900
}
```

Errors:
- `403 Invalid or revoked key`
- `403 Admin keys cannot activate clients`
- `403 Device limit reached for this key`

### `POST /v1/token/refresh`
Request:
```json
{ "refresh_token": "refresh-token" }
```

Response:
```json
{
  "access_token": "new-access-token",
  "refresh_token": "new-refresh-token",
  "expires_in": 900
}
```

## Admin Auth

### `POST /v1/admin/login`
Request:
```json
{ "key": "KNULL-ADM-..." }
```

Response:
```json
{
  "access_token": "admin-access-token",
  "refresh_token": "admin-refresh-token",
  "expires_in": 1800,
  "role": "admin"
}
```

### `GET /v1/admin/keys`
Headers:
- `Authorization: Bearer <admin access token>`

Response:
```json
{
  "keys": [
    {
      "id": "uuid",
      "key_type": "user",
      "owner_ref": "user_123",
      "label": "alpha",
      "status": "active",
      "max_devices": 1,
      "created_at": "...",
      "expires_at": null,
      "last_used_at": "..."
    }
  ]
}
```

### `POST /v1/admin/keys`
Headers:
- `Authorization: Bearer <admin access token>`

Request:
```json
{
  "key_type": "user",
  "owner_ref": "user_123",
  "label": "customer key",
  "max_devices": 1,
  "expires_in_days": 30
}
```

Response (one-time plaintext key):
```json
{
  "id": "uuid",
  "key": "KNULL-USR-...",
  "key_type": "user",
  "max_devices": 1,
  "expires_at": "..."
}
```

### `POST /v1/admin/keys/:id/revoke`
Headers:
- `Authorization: Bearer <admin access token>`

Response:
```json
{ "ok": true }
```

### `GET /v1/admin/keys/:id/devices`
Headers:
- `Authorization: Bearer <admin access token>`

Response:
```json
{
  "key": {
    "id": "uuid",
    "owner_ref": "user_123",
    "label": "customer key",
    "status": "active",
    "max_devices": 1
  },
  "devices": [
    {
      "device_id": "desktop-uuid",
      "app_version": "1.0.4",
      "activated_at": "...",
      "last_seen_at": "...",
      "revoked_at": null,
      "active": true
    }
  ]
}
```

Notes:
- Admin only.
- Non-admin or invalid callers receive `404 Not found` to avoid exposing admin-only capabilities.

### `POST /v1/admin/keys/:id/transfer-device`
Headers:
- `Authorization: Bearer <admin access token>`

Request:
```json
{
  "to_device_id": "new-device-uuid",
  "from_device_id": "old-device-uuid",
  "app_version": "1.0.4"
}
```

Notes:
- `to_device_id` is required.
- `from_device_id` is optional when the key has room for more devices.
- If the key is at its device limit, provide `from_device_id` to explicitly transfer capacity.
- For single-device keys (`max_devices = 1`), the server can auto-select the existing active device if `from_device_id` is omitted.
- Active sessions for `from_device_id` are revoked as part of transfer.
- Non-admin or invalid callers receive `404 Not found` for this route to avoid exposing admin-only capabilities.

Response:
```json
{
  "ok": true,
  "key_id": "uuid",
  "transferred_from": "old-device-uuid",
  "transferred_to": "new-device-uuid",
  "active_devices_after": ["new-device-uuid"],
  "revoked_by": "admin-key-id"
}
```

## Trigger Bus

### Client connection
Use WebSocket URL from activation response.

Client appends the access token in query string for MVP:
- `wss://bus.example.com/v1/triggers?token=...`

## Server -> Client Trigger Message
```json
{
  "type": "trigger",
  "event": {
    "event_id": "evt_001",
    "trigger_id": "discord:1234567890:987654321",
    "retailer": "walmart",
    "url": "https://www.walmart.com/ip/...",
    "detected_at": "2026-07-23T22:00:00.000Z",
    "ttl_seconds": 20,
    "sig": "optional-signature",
    "kid": "k1"
  }
}
```

## Client -> Server Ack Message
```json
{
  "type": "ack",
  "event_id": "evt_001",
  "trigger_id": "discord:1234567890:987654321",
  "status": "ok",
  "detail": "launched:6",
  "ts": "2026-07-23T22:00:01.000Z"
}
```

## Client launch mapping in this build
- Incoming trigger `retailer` is matched against local `TaskGroup.retailer`.
- Matching task groups are launched locally.
- For `walmart` and `costco`, incoming `url` overwrites each matching task group's `target_url` before launch.

## Notes
- Offline clients do not receive live triggers.
- Trigger dedupe key is `trigger_id` (fallback `event_id`).
- Expired events are ignored when `detected_at` + `ttl_seconds` has elapsed.
- Plaintext keys are only shown at creation time; store only `key_hash` in DB.
