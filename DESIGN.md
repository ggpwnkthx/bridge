---
name: Bridge
description: The studio of the headless data backend — a dark, instrument-like console for reading and changing the data of a workspace.
colors:
  studio-black: "#0f1115"
  panel-slate: "#161a21"
  raised-slate: "#1c212a"
  hairline: "#262c37"
  text-light: "#e6e9ef"
  instrument-grey: "#98a1b3"
  signal-blue: "#5b9dff"
  accent-soft: "rgba(91, 157, 255, 0.14)"
  on-accent: "#08111f"
  scrim: "rgba(4, 6, 10, 0.6)"
  fault-line: "rgba(255, 107, 107, 0.4)"
  fault-edge: "rgba(255, 107, 107, 0.35)"
  confirm-line: "rgba(74, 222, 128, 0.4)"
  fault-red: "#ff6b6b"
  confirm-green: "#4ade80"
typography:
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  subtitle:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  dense:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  micro:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.04em"
  touch:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "#08111f"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  button-ghost:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  button-danger:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.fault-red}"
    rounded: "{rounded.md}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  tag:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.instrument-grey}"
    rounded: "{rounded.pill}"
    padding: "1px 6px"
  table-header:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.instrument-grey}"
    typography: "600 11px system-ui"
  panel:
    backgroundColor: "{colors.panel-slate}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.lg}"
    padding: "16px"
  notice-error:
    backgroundColor: "{colors.panel-slate}"
    textColor: "{colors.fault-red}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  toast:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
---

# Design System: Bridge

## Overview

**Creative North Star: "The Night Shift"**

Bridge is the room where the platform is watched after hours. The studio is a console that is already on, dim, and patient: a dark field on which a single column of data arrives, is read, and is corrected. Nothing about it performs urgency. It is a set of instruments that are always legible because they never change their shape — the same table, the same drawer, the same refusal notice, every time, so that an operator's eye learns them once and then stops paying attention to them.

The personality is quiet, instrument-like and unsentimental. Every surface is flat and bordered; depth comes from tone alone, never from a shadow. There is no illustration, no mascot, no celebration: a saved record is a fact, reported plainly, and the only thing allowed to raise its voice is a refusal. Colour is rationed to a single accent that marks *where you are* and *what will happen next*, and to two semantic colours that mark *what went wrong* and *what succeeded*. Everything else is the ladder of four near-blacks and the two greys between them.

The studio is dense by design. A technical operator lives in it for hours and reads rows in quantity, so the table is compact, the type is small, and the chrome recedes to a single hairline border. Density is a feature; ornament is not. The governing test of any change to this system is simple: **could an operator still read the value they came for, and could they still tell what the backend refused?** If a change makes either harder, it is wrong.

**Key Characteristics:**

- Dark-only, four-step tonal ladder, one hairline between surfaces, zero shadows.
- One accent (Signal Blue) that only ever marks selection, focus, and the primary action.
- Identifiers, keys, workspaces and error codes set in monospace — they are quoted strings from the backend, not prose.
- Uppercase 11px micro-labels as the only "designed" typography; everything else is system type.
- Refusals are shown with their real code, message and request id, in fault red, never softened.

## Colors

A four-step near-black ladder with a single cool accent and two semantic colours; the whole palette is desaturated except the accent and the semantics.

### Primary

- **Signal Blue** (`#5b9dff`): the only accent. It marks the active collection in the sidebar, the primary button (Apply / Save / Create / Run), the focus ring of every control, the skip link, and the tinted action tag of the selected collection. It never decorates a heading, a value, or a chart.
- **On Accent** (`#08111f`): the label of a Signal Blue surface — the primary button and the skip link. It is the near-black of the page, not a new black.

### Neutral

- **Studio Black** (`#0f1115`): the page. The ground the console sits on.
- **Panel Slate** (`#161a21`): the chrome — topbar, sidebar, table surface, drawer, notice.
- **Raised Slate** (`#1c212a`): the raised surface — inputs, ghost buttons, toast body, table header, action tags, hovered rows.
- **Hairline** (`#262c37`): the single border token. Every separator in the studio is this one line, 1px, and nothing else.
- **Text Light** (`#e6e9ef`): body and heading text. 15.5:1 on Studio Black, 14.3:1 on Panel Slate.
- **Instrument Grey** (`#98a1b3`): secondary text — labels, hints, placeholders, the workspace id, column headers, the pager. 6.7:1 on Panel Slate, comfortably above AA.

### Semantic

- **Fault Red** (`#ff6b6b`): the refusal. The error notice, the error toast, and the Delete button's label and border.
- **Confirm Green** (`#4ade80`): the success toast only. It never appears on a row, a field, or a panel.

**The One Accent Rule.** Signal Blue appears on the primary action, the selected collection, the focus border, and nothing else. If a third place wants it, that place is decoration and loses.

**The Fault Is the Only Voice Rule.** Saturated colour is reserved for outcomes. Fault Red and Confirm Green may only appear where the studio is reporting a result — a toast or a notice — never as a state of a row, a field, or a control that is merely present.

**The Hairline Rule.** Two surfaces are separated by one 1px Hairline, never by a shadow, never by a gradient, never by a gap in colour.

## Typography

**Display Font:** none — the studio has no display type.
**Body Font:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
**Label/Mono Font:** `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`

**Character:** one system typeface for everything the studio says, one monospace face for everything the backend names. The pairing is deliberately undifferentiated — the interface has no typographic personality, because the personality belongs to the data and to the operator's command of it. Hierarchy is carried by size, weight and case, not by a second family.

### Hierarchy

- **Title** (600, 17px, 1.4): the collection label at the head of the toolbar, and the aggregate heading. The only large text on the screen.
- **Subtitle** (600, 15px, 1.4): the record heading inside the drawer, and the heading of a panel (14px).
- **Body** (400, 14px, 1.5): everything else — buttons, inputs, the identity in the topbar (13px).
- **Dense** (400, 13px): the values of the table, the body of a toast, the identity in the topbar.
- **Micro** (600, 10px, uppercase, 0.04em): the action tag of a collection.
- **Touch** (400, 16px): the fields of the studio where the pointer is coarse. It is the one size that grows with the input method: below 16px, the phone zooms under the finger.
- **Label** (600, 11px, uppercase, 0.06–0.12em tracking): the micro-labels — "Collections", the workspace id, the table's column headers, the drawer field labels. Never used for a value.
- **Mono** (400, 12px, 1.5): the ids, the record keys, the workspace, the ETags, the audit log's columns, and the JSON filter. See the Identifier Rule.

**The Identifier Rule.** Anything that the backend named — a record id, a collection key, a workspace, an ETag, a request id, an error code, a JSON filter — is set in the monospace face at 12px. Anything the studio composed for itself is set in the body face. This is how an operator tells a value that came from the system from a word the interface supplied.

**The Micro-Label Rule.** A label is 11px, uppercase, tracked `0.06em` or more, and Instrument Grey. A label is never larger than the value it labels, and never coloured with the accent.

**The Focus Ring Rule.** Every control that can be reached carries a 2px Signal Blue outline, 2px out from its edge. The ring is never removed, and it is never replaced by a change of colour alone: the caller must always be able to see where the keyboard is.

## Layout

The shell is a fixed three-part frame that never moves: a **56px topbar** across the top, a **260px sidebar** of collections on the left, and the **content pane** filling the rest.

- **Topbar (56px):** the wordmark and the studio's subtitle at the left, the caller's identity and roles at the right. A 1px Hairline below it, Panel Slate on Studio Black.
- **Sidebar (260px):** Panel Slate, a hairline on its right edge, its own scroll. The "Collections" micro-label and the workspace id sit at the top; the collection list scrolls; a hairline-topped footer holds Aggregate, Audit log and Log out. The collection list is the spine of the product — it never collapses.
- **Content pane:** `1fr`, its own scroll, padded `20px 24px 48px`. The bottom padding is generous so a scroll never ends flush against a row.
- **Toolbar:** a flex row, wrapping, `8px` gaps: the title, then the query controls (search, sort, rows per page, Run), then a flexible spacer, then the secondary actions (New record) and the advanced filter disclosure. The controls carry their names — a placeholder is an example, never the name of a control.
- **Table:** full width of the pane, inside a 10px-radius bordered wrapper with its own horizontal scroll. Header rows are sticky against the wrapper's top edge.
- **Drawer:** fixed to the right edge, `min(520px, 92vw)`, full height, its own scroll, `18px 20px 40px` padding, a hairline on its left edge, and a `rgba(4, 6, 10, 0.6)` scrim over the page behind it.

**Density:** compact and deliberate. Table cells are `9px 12px` at 13px type; a row reads as a line, not a card. The pager and the hints sit at 12px.

**Three widths, one studio.**

- **1024px and more:** the frame as it is — a 260px column of collections beside the content.
- **Below 1024px:** the collections go off the canvas. The topbar grows a **Collections** button; the sidebar becomes a panel over the content with its own scrim; it leaves the canvas as soon as a collection is chosen, as soon as Escape is pressed, and as soon as the way to it is used again. The table keeps its own horizontal scroll — it is never reflowed into cards, because a column of rows is what the operator reads.
- **Below 640px:** the toolbar folds into rows the thumb can reach — the search on its own line, the sort and the page size side by side, the two actions side by side. The subtitle of the studio and the roles of the caller leave the topbar, and the drawer of a record takes the whole width of the screen.

**The finger is not the cursor.** Where the pointer is coarse — a phone, a tablet — every control that can be reached is 44px high, the fields of the studio are 16px so that the phone does not zoom under the finger, and the hover states are gone: a hover that stays after a tap is a state that lies. Where the pointer is fine, the studio keeps its density: 13px values, 14px fields, 35px controls.

**The room around the screen.** The frame keeps away from the notch and the home indicator of the phone (`env(safe-area-inset-*)`), and the drawer of a record ends above the home indicator.

## Elevation & Depth

**There are no shadows in this system.** Depth is carried entirely by tone: Studio Black (page) → Panel Slate (chrome) → Raised Slate (raised controls), separated by a single 1px Hairline. The one overlay — the record drawer — is separated from the page by a scrim, not by a lift. A surface that is "on top" is a surface that is lighter, or a surface that is behind a scrim; there is no third mechanism, and none should be introduced.

The consequence is that the whole studio reads as one flat sheet with a few panels printed on it — quiet, matte, and free of the "card floating in space" look that would make a dense data console feel decorative.

**The Flat-By-Default Rule.** No element casts a shadow at rest, on hover, or on focus. A shadow appearing is a signal that something is wrong with the depth model, not a way to emphasise a control.

**The Scrim Rule.** Exactly one overlay pattern exists: a fixed surface over a `rgba(4, 6, 10, 0.6)` scrim. A second overlay reuses that scrim or does not exist.

## Shapes

Restrained and consistent: a **four-step radius ladder** — `10px` for panels, the table wrapper and notices; `8px` for buttons, inputs and collection items; `6px` for sidebar links; `999px` (pill) for action tags. Nothing is fully rounded except the tag, and nothing is square except the table itself.

Every surface is closed by a 1px Hairline border and nothing else. There are no gradients, no inner shadows, no texture, no image assets anywhere in the studio.

The form language is *instrument-like*: flat, bordered, small-radius, and uniform. A corner never varies between one component and the next.

## Components

### Buttons

- **Shape:** 8px radius, 1px Hairline border, `7px 12px` padding, 14px system type.
- **Primary:** Signal Blue fill with near-black text (`#08111f`) at weight 600. Exactly one primary per view — the action that the view is waiting on (Run, Save, Create). Never two.
- **Ghost:** Raised Slate fill, Text Light label, Hairline border; on hover the border turns Signal Blue.
- **Danger:** Raised Slate fill with a Fault Red label and a `rgba(255, 107, 107, 0.35)` border. Used for Delete only, and always inside the drawer, never on a row.
- **Hover / Focus:** there is no transform, no lift, no colour wash beyond the border. Disabled controls drop to `opacity: 0.45` and lose the pointer.

### Chips / Tags

- **Style:** 999px pill, Raised Slate fill, Instrument Grey label, `1px 6px` padding, 10px uppercase with `0.04em` tracking.
- **Use:** the permitted actions of a collection (create / read / update / delete) and nothing else. Inside the selected collection, the tag switches to a `rgba(91, 157, 255, 0.2)` fill with a Signal Blue label.
- **State:** there is no selected/unselected chip; a tag is a fact about the collection, not a control.

### Cards / Containers

- **Corner Style:** 10px.
- **Background:** Panel Slate; the table wrapper and the notice sit on it, the panel and the drawer on it too.
- **Border:** 1px Hairline. The error notice escalates its border to `rgba(255, 107, 107, 0.4)`.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Internal Padding:** `16px` for the panel, `12px 14px` for the notice, `20px 24px 48px` for the content pane.

### Inputs / Fields

- **Style:** Raised Slate fill, 1px Hairline border, 8px radius, `7px 10px` padding, 14px type. Textareas are monospace at 12px, `min-height: 120px`, full width — they hold JSON.
- **A field of lines is a field of lines.** A field of the type `text` is a textarea, in the monospace face: the lines of a body stay lines, and a body is never cut to its first line.
- **A field that has no value is an empty field.** The studio never writes the word "null" in a control, and it never sends a value it did not read. An empty field is left as it is.
- **Focus:** the border becomes Signal Blue. No glow, no ring, no shadow.
- **Error / Disabled:** a disabled field (one the caller may not write) keeps the same look and is simply not editable — it is never visually redacted, because the operator must be able to see the value they are not allowed to change.
- **Labels:** the drawer field label is a micro-label above the control, with `*` marking a required field, and the field description as an 11px hint below it.

### Navigation

- **A skip link** is the first thing in the frame: "Skip to the content". It is invisible until the keyboard reaches it, and then it is Signal Blue. The side bar comes before the content of every view, and the caller must not have to walk through it every time.
- **The way to the collections** is a button in the topbar that appears only on a small screen. It carries `aria-expanded`, and the collections it opens are a panel over the content, not a page of their own.
- **The open view is marked.** The collection that is open is tinted, and so is the view — the aggregate or the audit log — that is on the screen. The studio never leaves the caller guessing which of the three views is in front of them.
- **Style:** the topbar is a 56px band of Panel Slate with a Hairline below; the sidebar is a 260px Panel Slate column with a Hairline on its right edge.
- **Collections:** a flat list, each item `8px 10px` with an 8px radius. Hover raises the fill to Raised Slate. The selected collection takes a `rgba(91, 157, 255, 0.14)` fill and a Signal Blue label.
- **Footer links:** Aggregate, Audit log, Log out — Instrument Grey, 8px radius, transparent at rest, Raised Slate on hover.
- **Mobile treatment:** none. The sidebar is fixed-width and never collapses.

### Tables (signature)

The table is the studio's primary artefact and deserves exactness.

- **Header:** sticky at the top of the wrapper, Raised Slate fill, Instrument Grey, 11px uppercase with `0.06em` tracking, `9px 12px` padding, `scope="col"`.
- **Cells:** 13px, `9px 12px`, 1px Hairline beneath, `nowrap`, truncated with an ellipsis at a 320px maximum — a long value is clipped in the view but never hidden from the record drawer.
- **The first cell is a button.** The row is the hit target for the mouse, and the first cell is the hit target for the keyboard: it is a real `<button>` that opens the record, carrying the visible value and a hidden ", open the record of {collection}". Its focus ring is always visible.
- **A null value** is set in Instrument Grey italic as an em dash, so absence reads differently from an empty string.
- **The id column** is monospace at 12px.
- **The table carries a caption**, hidden, that names the collection it holds.
- **An empty table says what is empty** — "This collection has no row." — and offers the action that would fill it. It is never a blank rectangle.

### The Record Drawer (signature)

A fixed right-hand panel, `min(520px, 92vw)`, full height, Panel Slate, Hairline on the left edge, over a scrim.

- **It is a dialog.** `role="dialog"`, `aria-modal="true"`, named by its own heading. The focus moves into it when it opens, stays inside it while it is open, and comes back to the row that opened it when it closes. The page behind it is inert.
- **Head:** the record id or "New record of {collection}" at 15px/600, with the record id in mono and the collection key beneath it in mono at 12px.
- **Body:** one field per row — micro-label, control, optional hint — at 12px margins. Every label is bound to its control, and every hint is read with it. A field the caller may not write is disabled, not concealed.
- **Actions:** Primary (Save or Create), then Danger (Delete) when permitted, then Ghost (Close), in a row at the foot of the form.
- **The delete asks twice, in the drawer.** The first click turns the actions into the question — "Delete the record rec_01 of Posts?" — with Delete and Keep it. There is no browser dialog.
- **Escape closes it;** clicking the scrim closes it. The drawer is the only overlay in the studio.

### Notices and Toasts

- **A wait is named.** While the studio waits, the area of the results says what it is doing — "Loading the rows of Posts." — and is marked busy for the screen reader. The studio never shows a screen that looks like an answer and is not one.
- **Notice:** an inline, bordered, Panel Slate block. The error notice carries the backend's code in bold, its message, and the request id as a hint, and it offers **Try again** when the request can be made again.
- **Toast:** bottom-right, Raised Slate, 8px radius, 1px Hairline, max 420px wide, dismissed after 6 seconds (12 for a refusal). It stays while the pointer is on it. The success is Confirm Green; the failure is Fault Red and is announced at once. A toast reports; a notice persists.
- **A request that did not answer at all** is not a refusal: the studio says the server could not be reached and that nothing was changed.

## Do's and Don'ts

### Do:

- **Do** keep the value the operator came for in front of them: dense tables, small type, minimal chrome, and the record drawer for the full value.
- **Do** set anything the backend named — ids, keys, workspaces, ETags, request ids, error codes, JSON — in the monospace face.
- **Do** show a refusal with its own code, message and request id, in Fault Red, and keep it on screen rather than a transient toast alone.
- **Do** use exactly one Primary button per view, and reserve Signal Blue for selection, focus and that button.
- **Do** separate surfaces with a 1px Hairline and a step in the tonal ladder, and nothing else.
- **Do** keep the density: 13px table text, `9px 12px` cells, 12px hints and pagers.
- **Do** keep the whole studio dark. There is no light mode, and the palette is not built to produce one by inversion.
- **Do** give every control a name a screen reader can read, and every control that can be reached a focus ring that cannot be lost.
- **Do** say what is empty, and offer the action that would fill it. An empty state is a sentence, not a blank rectangle.
- **Do** keep the table a table on every screen: it scrolls sideways inside its own frame, and it never becomes a stack of cards.

### Don't:

- **Don't** add a shadow. Depth is tone and hairline; a shadow is the one addition that would break the model.
- **Don't** add a gradient, a texture, an image, an icon font, or an illustration. The studio has no image assets, and the operator's attention belongs on the data.
- **Don't** use Signal Blue as decoration, and don't use Confirm Green or Fault Red for anything other than an outcome being reported.
- **Don't** soften a refusal — no reworded error, no redacted code, no "something went wrong" in place of the backend's message.
- **Don't** celebrate a save. The success toast states a fact in one line and disappears.
- **Don't** hide a value the caller may not change. A read-only field stays visible and legible; it is disabled, not concealed.
- **Don't** enlarge the type or add breathing room to the table to make it friendlier. The density is the affordance for an operator who reads rows in quantity.
- **Don't** round a container fully or square one off. The radius ladder is 10 / 8 / 6, with the pill reserved for tags.
- **Don't** take a task to the browser's own dialog. The studio asks its own questions, in its own words.
- **Don't** rely on a hover where there is no pointer, and don't shrink a control below the reach of a finger.
