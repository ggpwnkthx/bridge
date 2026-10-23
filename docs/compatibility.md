# The compatibility of the studio

The studio is a client of the platform: it talks to the broker for the
login of the callers, to the gateway for the data and to the backend
behind the gateway. A change of the contract of one of the three is a
change of the contract of the studio, and the studio has to know of it
before the deployment does.

This document owns the **baseline** of that compatibility: the
revisions of the platform that the studio is tested against.

## The manifest

The baseline is the file `compatibility.json`, at the root of the
repository. It is the one place that owns the repositories of the
platform and the revisions that are tested against them: a pin that is
written twice is a pin that will drift.

```json
{
  "version": 1,
  "repositories": {
    "shuttle": { "url": "https://github.com/ggpwnkthx/shuttle.git", "commit": "…" },
    "hub": { "url": "https://github.com/ggpwnkthx/hub.git", "commit": "…" },
    "depot": { "url": "https://github.com/ggpwnkthx/depot.git", "commit": "…" }
  }
}
```

A revision is a commit and not a branch: a branch moves, and a baseline
that moves is not a baseline. The revision is refused when it is not a
full revision of forty hexadecimal characters.

## The baseline

<!-- compatibility-baseline:start -->

The baseline of the compatibility is the one of `compatibility.json`:
the one file of this repository that owns the repositories of the
platform and the revisions that are tested against them.

| Project | Repository | Revision |
| --- | --- | --- |
| shuttle | https://github.com/ggpwnkthx/shuttle.git | `0e09a420f8d5f7f3e2eea63512f808ce4ae215e0` |
| hub | https://github.com/ggpwnkthx/hub.git | `ef69e2fdd683572a68585c9234498e1cec3850f9` |
| depot | https://github.com/ggpwnkthx/depot.git | `4ba1eed62942390296a17ec4b029803e48ebad6e` |

<!-- compatibility-baseline:end -->

The block above is written by the check of the drift:

```bash
bun run check:compatibility --write
```

The check refuses a documentation that does not agree with the manifest,
and a workflow that holds a revision of its own.

## The harness

The harness runs the **real** gateway, the **real** broker and the
**real** backend of the baseline, and it drives the **real** studio
against them: the login of a caller, the catalog of a workspace, a
collection and a write.

```bash
bun run test:compat
```

The three repositories are cloned at the revisions of the manifest into
a temporary directory, they are never modified, and the stack of the run
is started on the ports of the run — the studio of the run answers at
`http://localhost:8181`. The temporary directory is removed at the end
of the run, unless `COMPAT_KEEP` is set.

The environment overrides the manifest for a run that tests another
revision — a candidate:

| The variable | What it holds |
| --- | --- |
| `SHUTTLE_REPOSITORY` / `SHUTTLE_COMMIT` | The repository and the revision of the gateway. |
| `HUB_REPOSITORY` / `HUB_COMMIT` | The repository and the revision of the broker. |
| `DEPOT_REPOSITORY` / `DEPOT_COMMIT` | The repository and the revision of the backend. |
| `SHUTTLE_CHECKOUT` / `HUB_CHECKOUT` / `DEPOT_CHECKOUT` | A checkout that is already prepared: it is used as it is, and it is checked before the run. |
| `COMPAT_MIRROR` | A directory that holds the bare mirrors `shuttle.git`, `hub.git` and `depot.git`. |
| `COMPAT_WORKSPACE` | The directory the checkouts are created in. |
| `COMPAT_KEEP` | When it is set, the directory of the run is kept. |

An override that is set and that cannot be used is an error: the harness
never falls back to another source, because a run that tested another
revision would prove nothing.

## The two revisions

The studio is tested against **two** revisions of the platform, and the
two are not the same thing:

- the **baseline** of `compatibility.json` — the released platform the
  studio is proven against. It is the revision of the manifest, and it
  is the one a deployment of the studio can count on.
- the **head** of the three repositories — the platform that is being
  built. The job of the interface of the studio in the workflow of the
  gates checks the studio against it, and it is the one that says
  early that a change of the platform breaks the studio.

The two together are the proof: the studio works with the platform of
today, and it works with the platform of the day after.
