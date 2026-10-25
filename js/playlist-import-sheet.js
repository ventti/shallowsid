import { esc, thumb, subtitle } from './ui.js';
import { comparePlaylists, mergedItems, sameItems } from './playlist-merge.js';

// A native modal provides focus trapping, Escape cancellation and a contained scroll area.
export function playlistImportSheet(matches, incoming, index, skipped = 0) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'playlist-import-sheet';
    document.body.append(dialog);
    let target = matches.length === 1 ? matches[0] : null;
    let original, comparison, choices, order = 'existing', mode = 'start';
    const decided = new Set();
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    const optionsFor = row => row.kind === 'added' ? [['add', 'Add'], ['skip', 'Skip']]
      : row.kind === 'removed' ? [['keep', 'Keep'], ['remove', 'Remove']]
      : [['existing', `Current · Subtune ${row.existing.song}`], ['new', `Imported · Subtune ${row.incoming.song}`], ['both', 'Keep both']];
    function segment(key, value, options) {
      return `<ion-segment mode="ios" data-merge-segment="${key}" value="${esc(value)}" aria-label="${key === 'order' ? 'Song order' : 'Choose change'}">${options.map(([v, text]) => {
        const [title, detail] = text.split(' · ');
        return `<ion-segment-button value="${esc(v)}"><ion-label>${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ''}</ion-label></ion-segment-button>`;
      }).join('')}</ion-segment>`;
    }
    function begin() {
      if (!comparison) {
        original = target.items.map(item => ({ ...item }));
        comparison = comparePlaylists(original, incoming.items);
        choices = new Map(comparison.differences.map(row => [row, optionsFor(row)[0][0]]));
        decided.clear(); order = 'existing';
      }
      mode = 'review';
      render();
    }
    function render() {
      let body = '', footer = '';
      if (mode === 'start') {
        const diff = target && comparePlaylists(target.items, incoming.items);
        const counts = diff ? [
          [diff.differences.filter(r => r.kind === 'added').length, 'added'],
          [diff.differences.filter(r => r.kind === 'removed').length, 'removed'],
          [diff.differences.filter(r => r.kind === 'subtune').length, diff.differences.filter(r => r.kind === 'subtune').length === 1 ? 'subtune change' : 'subtune changes'],
        ].filter(([count]) => count).map(([count, text]) => `${count} ${text}`) : [];
        if (diff?.orderChanged) counts.push('Order changed');
        body = `<p class="merge-playlist-name">${esc(incoming.name)}</p>
          ${counts.length ? `<p class="merge-subtitle">${counts.join(' · ')}</p>` : ''}
          ${matches.length > 1 ? `<fieldset aria-label="Update playlist">${matches.map((p, i) => `<label><input type="radio" name="merge-target" value="${i}" ${target === p ? 'checked' : ''}><span>${esc(p.name)}<small>${p.items.length} tunes · ${esc(new Date(p.created).toLocaleDateString())}</small></span></label>`).join('')}</fieldset>` : ''}
          <ion-list inset class="merge-start-actions">
            <ion-item button detail="false" data-action="review" ${!target ? 'disabled' : ''}>
              <ion-icon slot="start" name="git-compare-outline" color="primary"></ion-icon><ion-label color="primary">Review Changes</ion-label>
            </ion-item>
            <ion-item button detail="false" data-action="new" ${!target ? 'disabled' : ''}>
              <ion-icon slot="start" name="refresh-outline" color="primary"></ion-icon><ion-label color="primary">Replace Playlist</ion-label>
            </ion-item>
            <ion-item button detail="false" data-action="copy" lines="none">
              <ion-icon slot="start" name="copy-outline" color="primary"></ion-icon><ion-label color="primary">Save as New Playlist</ion-label>
            </ion-item>
          </ion-list>`;
        footer = `<span></span>`;
      } else if (mode === 'review') {
        body = `${comparison.differences.length ? `<p class="merge-subtitle">${comparison.differences.length} differences</p>` : ''}
          <div class="merge-differences">${comparison.differences.map((row, rowIndex) => {
            const item = row.existing || row.incoming;
            const tune = index.get(item.path);
            const title = tune?.title || item.path.split('/').pop();
            const ambiguous = tune && comparison.differences.some(other => {
              const path = (other.existing || other.incoming).path;
              return path !== item.path && index.get(path)?.title === title && index.get(path)?.author === tune.author;
            });
            return `<article class="merge-difference">
              <div class="merge-tune">${tune ? thumb(tune) : ''}<div><h3>${esc(title)}${row.kind !== 'subtune' && tune?.songs > 1 ? ` <span class="song-chip">#${item.song}/${tune.songs}</span>` : ''}</h3>
              ${tune ? `<p class="merge-path">${esc(subtitle(tune))}</p>` : ''}
              ${!tune || ambiguous ? `<p class="merge-path">${esc(item.path)}</p>` : ''}</div></div>
              ${segment(`choice-${rowIndex}`, choices.get(row), optionsFor(row))}
              ${comparison.differences.slice(rowIndex + 1).some(r => r.kind === row.kind) ? `<button class="merge-remaining" data-action="remaining" data-row="${rowIndex}">Apply to Remaining ${row.kind === 'added' ? 'Additions' : row.kind === 'removed' ? 'Removals' : 'Subtune Changes'}</button>` : ''}
            </article>`;
          }).join('')}</div>`;
        if (!sameItems(mergedItems(comparison.rows, choices), mergedItems(comparison.rows, choices, 'new'))) {
          body += `<h3>Song order</h3>${segment('order', order, [['existing', 'Current order'], ['new', 'Imported order']])}`;
        }
        footer = `<button data-action="back">Back</button><button class="merge-primary" data-action="save">Save Changes</button>`;
      }
      dialog.innerHTML = `<header><button data-action="cancel">Cancel</button><h2 id="merge-heading">${mode === 'start' ? 'Playlist already exists' : 'Review Changes'}</h2></header>
        <section>${skipped ? `<p class="merge-warning">${skipped} files could not be matched and are excluded from the imported playlist.</p>` : ''}${body}</section>
        <footer>${footer}</footer>`;
      dialog.setAttribute('aria-labelledby', 'merge-heading');
      if (dialog.open) dialog.querySelector('[data-action="cancel"]')?.focus();
    }
    dialog.addEventListener('change', event => {
      if (event.target.name === 'merge-target') { target = matches[Number(event.target.value)]; comparison = null; render(); }
    });
    dialog.addEventListener('ionChange', event => {
      const key = event.target.dataset.mergeSegment;
      const value = event.detail.value;
      if (key === 'order' && ['existing', 'new'].includes(value)) order = value;
      if (key?.startsWith('choice-')) {
        const row = comparison.differences[Number(key.slice(7))];
        if (row && optionsFor(row).some(([option]) => option === value)) {
          choices.set(row, value);
          decided.add(row);
        }
      }
    });
    dialog.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      const action = button?.dataset.action;
      if (!action) return;
      if (action === 'cancel') return finish(null);
      if (action === 'copy') return finish({ kind: 'copy' });
      if (action === 'review') return begin();
      if (action === 'save') return finish({ kind: 'update', target, items: mergedItems(comparison.rows, choices, order), original });
      if (action === 'back') { mode = 'start'; return render(); }
      if (action === 'remaining') {
        const rowIndex = Number(button.dataset.row);
        const row = comparison.differences[rowIndex];
        const value = choices.get(row);
        decided.add(row);
        comparison.differences.slice(rowIndex + 1).forEach((other, offset) => {
          if (other.kind !== row.kind || decided.has(other)) return;
          choices.set(other, value);
          decided.add(other);
          const control = dialog.querySelector(`[data-merge-segment="choice-${rowIndex + offset + 1}"]`);
          if (control) control.value = value;
        });
        return;
      }
      if (action === 'new') {
        begin();
        comparison.differences.forEach(row => choices.set(row, row.kind === 'added' ? 'add' : row.kind === 'removed' ? 'remove' : 'new'));
        order = 'new'; render();
      }
    });
    render(); dialog.showModal();
  });
}
