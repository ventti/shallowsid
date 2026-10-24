# UI preferences

- Reuse an existing menu or dialog pattern before creating a new one. Keep equivalent interactions consistent in layout, spacing, controls, and behavior.
- Do not use native HTML dropdowns (`<select>`). Use controls styled like the rest of ShallowSID; for a few choices, use radio rows or segmented controls.
- Use the shared colors, fonts, and other style variables in `css/app.css`.
- Keep multi-step modals the same size across steps. Keep navigation buttons in fixed positions and scroll longer content inside the modal.
- For two-way and three-way choices, reuse the Ionic segmented controls from Sound settings. Show related playlist differences together in a scrollable review list.

# UI development guidelines

These patterns come from the existing UI. Follow the closest working example; do not copy an isolated exception into a new convention.

## Look and layout

- Build with Ionic web components in iOS mode (`js/ionic-config.js`), with small overrides in `css/app.css`. Do not introduce a second component library or a separate visual theme.
- Keep the always-dark palette: `--app-bg` for pages, `--app-surface` for grouped controls and cards, `--app-text` for primary text, `--app-muted` for supporting text, and `--app-border` for dividers. Use the lavender `--app-accent` for actions and selection; use Ionic warning/danger colors for those states.
- Inherit Ionic's UI font. Reuse the existing type sizes and spacing of the neighboring component instead of adding a new scale. Use tabular numbers for changing times and numeric values.
- Design for phones first. Preserve safe-area padding, the bottom tab bar, and the mini-player. At 992px, Now Playing moves into the side panel and the mini-player disappears; reuse the same player element and state (`js/now-playing.js`).
- Settings use the centered `.settings-container` (maximum 640px), `.sound-section` headings, and inset `ion-list` groups on the surface color. Keep related controls together; put necessary notes immediately below their group.

## Navigation and lists

- Use the existing hash routes and `setChrome()` in `js/app.js` for titles, Back, toolbar actions, search visibility, and selected tabs. Extend the existing navigation rather than adding an independent header or routing system.
- Reuse `tuneRow()`, `thumb()`, `subtitle()`, and `formatTime()` from `js/ui.js`. Tune rows show artwork, title and subtune, composer/year and tags, then duration and the More button. Clicking the row plays; More opens its action sheet without playing it.
- Preserve the row states: lavender for the current tune/subtune, the alternate accent for another subtune of that tune, a star for Favorites, and a muted, non-playing row for missing tunes. Keep missing entries available for playlist management.
- Use `showList()` and its paging for long tune lists. Update row marks without replacing the whole list when possible, preserving scroll position. Reuse the count/sort bar and checked sort choices.
- Keep artwork and tags secondary to the title. Reuse the existing artwork helpers, thumbnail sizes, and tag capsules; do not let long metadata push trailing controls offscreen.

## Controls and feedback

- Use segmented controls for short, exclusive choices; labeled toggles for on/off settings; ranges with visible values for continuous adjustments; and checked rows or action sheets for longer choices. `ion-select` with `interface="action-sheet"` is an existing pattern for subtunes, distinct from a native HTML dropdown.
- Put secondary item actions behind the existing ellipsis button. Reuse Ionicons and existing action wording/order for equivalent actions. Mark destructive actions with `role: "destructive"`.
- Reuse `actionSheet`, `prompt`, `confirmDialog`, `infoDialog`, and `toast` from `js/ui.js`. The helpers handle overlay cleanup and cancellation. Prompts keep validation errors inside the open dialog; info dialog messages are plain text.
- Use brief top toasts only for recoverable errors (default 2200ms). Do not use toasts for successful actions, status updates, or other non-errors. Use a persistent page state for errors that prevent the page from working. Do not report a cancelled picker or share dialog as success or failure; reuse `saveFile()` and inspect its result.
- Use `.empty` for loading, empty, and unavailable states. Show a spinner while waiting, then a short, specific message and an action when one is useful.
- Use plain action labels such as Add, Remove, Rename, and Save Changes. Keep terminology aligned with the surrounding screen. Avoid instructional paragraphs that repeat what controls already show; retain essential warnings about data loss, sharing, or excluded files.

## Editing and dialogs

- Match the screen's existing save behavior. Sound settings apply immediately; preset sliders preview during dragging and persist on release. Tag editing uses a draft: Done or sheet dismissal saves, explicit Cancel discards (`js/tag-sheet.js`). Do not assume all dismissals mean Cancel.
- For a multi-step review, follow `js/playlist-import-sheet.js`: stable dialog dimensions, fixed header/footer, scrolling body, Back/Cancel, and a clearly labeled final save action. Keep choices when going back; cancellation must leave playlist data unchanged.
- Explain the actual scope before destructive operations (for example, a local playlist versus the synced server copy). Reuse the relevant confirmation pattern rather than adding confirmations to every reversible action.
- An open overlay can outlive a sync update or deletion. Recheck the target before applying changes; do not overwrite newer state using an old row position.

## Accessibility and verification

- Give icon-only buttons accessible names. Expose selected, pressed, and checked states as appropriate; keep labels in sync with changing playback state. Decorative artwork should not create redundant announcements.
- Preserve keyboard operation and visible focus. Custom dialogs need an accessible title, contained focus, and Escape handling; reuse the existing modal/dialog behavior. Gestures must have visible button alternatives and must not intercept nested buttons or links (`js/gestures.js`).
- For UI changes, check phone and desktop layouts, long names, empty/loading/error states, and keyboard use. For dialogs, also check scrolling, Back, Cancel, dismissal, and final save. Verify the existing flow touched by the change; report any checks that could not be run.

## Reference files

- `index.html`, `js/app.js`: app shell, navigation, search, lists, and item menus.
- `css/app.css`, `js/ionic-config.js`: shared appearance, sizing, responsive layout, and Ionic mode.
- `js/ui.js`: tune rows, overlay helpers, file saving, and formatting.
- `js/sound-sheet.js`, `js/rom-sheet.js`, `js/sync-sheet.js`: grouped settings and immediate actions.
- `js/playlist-import-sheet.js`, `js/tag-sheet.js`: multi-step review and draft editing.
- `js/now-playing.js`, `js/gestures.js`: shared responsive player, state labels, and touch interactions.
