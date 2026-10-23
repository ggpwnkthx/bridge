/**
 * The script of the browser.
 *
 * The studio is rendered by the server, and the script of the browser
 * takes it over: it reads the session of the caller and the metadata of
 * the deployment, and it renders the collections, the rows and the
 * drawer of a record.
 *
 * The script never talks to the backend and it never holds a token: the
 * studio holds it, and the studio is the only thing that knows the
 * gateway.
 */

import { hydrate } from 'preact/compat'
import { Studio } from '../components/studio'

const root = document.getElementById('studio')
if (root) {
  hydrate(<Studio workspace={root.dataset.workspace ?? ''} />, root)
}
