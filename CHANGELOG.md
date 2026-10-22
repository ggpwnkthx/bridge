# The changes of the studio

The format follows [Keep a Changelog](https://keepachangelog.com), and
the versions follow [semantic versioning](https://semver.org).

## 0.1.0

The first release of the studio.

### Added

- The login of the callers against the broker of the platform, with the
  authorization code flow and PKCE, and a session that lives on the
  server.
- The verification of the identity of the gateway, with the signature
  `v5` (the public key of the deployment) and the signature `v4` (the
  derived key), and the refusal of a request that did not come through
  the gateway.
- The api of the studio: the identity of the caller, the metadata of the
  collections, the rows, the aggregates and the audit log of a workspace.
- The studio itself: the collections in the side bar, the table of the
  rows with its query, the drawer of a record with its change and its
  deletion, the view of the aggregate and the view of the audit log.
- The protection of the changes of the state against a forged request,
  with a token of the session and the origin of the request.
- The configuration of the deployment, the probes and the structured
  logs.
