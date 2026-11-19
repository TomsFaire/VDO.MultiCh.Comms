# Security

## MVP model: shared room password

- Access control is a shared `comms_password`, applied to the push URL, guest join link, and director link. The room ID alone is not enough to join.
- Rooms live on public vdo.ninja unless you set `vdo_base_url` to a self-hosted instance. A room is just an ID in the URL; nothing is pre-created.
- Treat the join link and QR as secrets: they carry the room and password.
- **TURN credentials** (Internet mode) appear in the shareable join link and QR. Acceptable at this security level. Time-limited TURN credentials would fix this later.
- Session codes (Settings, Export) contain the password and TURN credentials. Share them only with people who should run boxes.
- Rotate by changing the password on all boxes (and re-sending links) and, if needed, the TURN credential.

## Max participants (`roomcap`)

Optional, off by default (no param sent when empty). Enforced at join time, so changing it never kicks connected boxes. If set to N, the N+1th join is refused.

## Why `requireapproval` was rejected

Tested: after a dropped connection the host must re-admit the participant. A weekly reboot or network blip would leave an unattended box stuck outside the room. Not viable for unattended boxes.

## Next phase: SSO

SSO is planned, not rejected. It works with the existing Google setup. The open concern is an unattended box needing an interactive re-login when the Google session expires. **This is a concern, not a tested result.** The MVP ships password-only so it is not blocked on this.

vdo.ninja documents two tokens that may resolve it:

| Token | Source | Lifetime | Use |
|---|---|---|---|
| `authtoken` | Interactive Google sign-in | 7 days | Humans in their own browser |
| `universaltoken` | Room-scoped bearer token | 90 days | Links that skip interactive login (e.g. OBS sources) |

Likely end state: humans sign in with Google (`&requireauth`); boxes hold a `universaltoken` stored in config and included in the session code. Nothing else in the app changes.

### Hooks already in the MVP

- All vdo.ninja URLs are built in one shared URL module; SSO params get added only there.
- That module reads an `auth` section from config: `{ mode: 'password' }` now, `{ mode: 'sso', universaltoken }` later.
- The watchdog separates "auth failed" from "network down" (a `did-navigate` to a non-room URL such as a login page signals auth).

### Open validation questions (spike after the MVP runs)

1. Does a `universaltoken` work for a publishing box (push plus listen), or only view-only sources?
2. At 90-day expiry, what does the hidden view do: error, login page, or silence? The status card must surface it, and a rotation procedure must be documented.
3. Is the 7-day `authtoken` renewed silently while the Google session lives, or is it a hard re-login every 7 days?
4. Does reconnect (weekly reboot, network drop) need anything beyond the stored token?
