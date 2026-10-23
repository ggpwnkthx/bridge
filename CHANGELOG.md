# The changes of the studio

The format follows [Keep a Changelog](https://keepachangelog.com), and
the versions follow [semantic versioning](https://semver.org).

## Unreleased

### Added

- The test of the interface of the studio: `bun run dev:ui` drives it in
  a browser, against the development machine, and checks the shapes the
  studio shows, the writes it makes and its accessibility with axe. The
  runner of the continuous integration runs it with the gates of the
  repository.
- The runner of the development machine: `bun run dev:stack` starts the
  studio, the broker, the gateway and the backend, with the database and
  the fixtures of a development machine, and `bun run dev:smoke` drives
  the login of a caller and a write through the whole stack. The wiring
  is described in [`docs/development.md`](docs/development.md).

### Changed

- The runner of the development machine repairs the drift of the schema:
  a migration of a checkout that was renamed or changed after it was
  applied builds the database of the service again, and the runner says
  what it repaired. The gateway signs the identity of a request with the
  key of the machine — the private key in `.dev/identity-key.pem`, the
  public one in `.dev/identity.key` — and the backend verifies it with
  the public one, as the format `v5` of the identity requires.
- The runner of the development machine stops the stack that is already
  there: `bun run dev:stack` kills the processes of the runs that came
  before it — the run that is alive, the services that outlived it and
  the database of a run that died — and starts its own. The registry of
  the processes of the runs is in `.dev/processes`, and it is described
  in [`docs/development.md`](docs/development.md).
- The studio says which of its three views is open: the aggregate or the
  audit log is marked in the side bar, like the collection that is open.
- The language of the studio says what it does: the query of the
  collection is *Run* everywhere, the page of the rows is *Rows per
  page*, the sort and the metrics of the aggregate carry their names,
  and a wait is named — "Loading the rows of Posts." — while the studio
  waits.
- The collection now says what it holds, in the words of the backend,
  under its name.
- The studio answers on a small screen: below 1024px the collections go
  off the canvas, behind the way to them in the top bar, and below 640px
  the toolbar of the query folds into rows that a thumb can reach. The
  table of the rows keeps its own scroll and is never reflowed into
  cards.
- The controls of the studio answer to a finger: where the pointer is
  coarse, every control that can be reached is 44 pixels high, the
  fields are 16 pixels so that the phone does not zoom under the finger,
  and the hover states are gone.
- The frame of the studio keeps away from the notch and the home
  indicator of the phone.
- The studio is usable with the keyboard alone: a row of the table opens
  its record with a button, the drawer of a record is a dialog that keeps
  the focus inside itself and gives it back, every control of the query
  and of the form carries a name that is read, and the studio announces
  what it saves and what it refuses.
- The deletion of a record asks its question in the drawer of the record,
  in the words of the studio, and not in the dialog of the browser.
- The studio says what is empty: a collection without a row, an aggregate
  without a group, an audit log without an entry.
- A request that did not answer is not a refusal: the studio says that
  the server could not be reached, that nothing was changed, and it
  offers to try again.
- The counts are written the way the language writes them: one row, two
  rows.

### Fixed

- The rows of a collection had no identity: the first column was the
  first field of the backend, often the body of the record, and the
  identifier of the record was in no column at all. The name of the
  record comes first now, with the identifier of the record under it,
  and the columns carry the name of the backend in their tooltip.
- The table of the rows was wider than the window: the last columns were
  cut off and the caller had to scroll to find them. The table keeps the
  width of the window, and the name of the record stays in sight while
  the row scrolls.
- The permissions of a collection were four letters — `R C U D` — that
  nobody could read. The studio says what the backend lets the caller do
  with the collection, in the words of the backend.
- The audit log was a dead end: the pager was hidden, so the entries
  past the first page could not be reached, the columns carried the
  names of the fields of the backend, and the fields that changed were a
  fragment of json. The log is paged, its columns are named, the moments
  are moments, and the fields that changed are a list.
- The drawer of a record threw away the changes that were not saved
  without asking: the escape key, the close button and the click outside
  the drawer all closed it, and the value the caller had written was
  gone. The drawer asks now, in the same language as the deletion of a
  record, and the escape key behaves the same everywhere.
- The aggregate opened on an aggregate without a grouping: a table of
  one column and one row, the number of the rows of the collection. It
  asks for the fields to group by now.
- The frame of the studio ended where its content ended: the side bar
  stopped in the middle of the screen and left a bare strip below it.
  The frame owns the height of the window now.
- The brand line of the studio said "the studio of the data backend",
  and the product says "the studio of the headless data backend".

- The value of a field of a record: the studio wrote every value as
  text, and the backend refuses a text for an integer and for a json. It
  writes the value the field declares now: a number for an integer, the
  document for a json, and the text for everything else.
- A field of a record that the caller emptied: the studio left the old
  value in place, because it wrote nothing for an empty field. A field
  that held a value and that the caller emptied is written as null now.
- A field of a collection that cannot be empty: the studio offered the
  empty choice in a menu of values that the record cannot hold.
- The drawer of a record was a complementary landmark with the role of a
  dialog; it is a dialog now.
- A field of a record that had no value: the studio wrote the word
  "null" in the control and sent it back, and the validator of the
  backend refused every change of a record with an empty field. A field
  with no value is now an empty field, and the studio sends no value it
  did not read.
- A field of the type `text`: it was a one-line control, and the lines
  of a body were cut to the first one. It is a field of lines now.
- A boolean field of a record: a value that was true showed as an
  unticked box, and the record was written with the value of the box
  instead of the value of the record.
- The path of the built assets: the studio resolved the directory of its
  user interface one level above the repository, so it answered `503`
  to the shell of the studio and served no script to the browser.
- The contrast of the tag of the collection that is open: it was below
  the minimum of the standard.
- The focus of the keyboard, which was lost at every answer of the rows.
- The answer of a request that arrived late, which could replace the
  answer of a newer request.

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
