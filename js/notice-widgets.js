// Live parts a notice can show (see notices.js), to bring this browser's data
// to another site, right in the notice.
//
// {widget:sync <site>}: Sync.
//   * elsewhere: Turn On Sync, then the key, Copy Key, and Continue on <site>,
//     which opens <site> with the key in the link (#/sync/<key>, never sent
//     to a server); <site> asks before joining, as for a scanned QR code.
//   * on <site>: Use a Key from Another Device…
// Without <site>, it's the second kind everywhere.
//
// {widget:data <site>}: the data as a file (user-data.js). Export Data…
// elsewhere, Import Data… on <site>.

import { esc, toast } from "./ui.js";

const item = (id, icon, label, { disabled = false, last = false } = {}) => `
  <ion-item button detail="false" data-sync-action="${id}" ${disabled ? "disabled" : ""} ${last ? `lines="none"` : ""}>
    <ion-icon slot="start" name="${icon}" color="primary"></ion-icon><ion-label color="primary">${label}</ion-label>
  </ion-item>`;

function statusRow(sync) {
  const error = sync.status === "error";
  const text = sync.status === "syncing" ? "Syncing…" : error ? `Couldn't sync: ${sync.error}` : sync.status === "synced" ? "Synced" : "Waiting to sync";
  return `<ion-item>
    <ion-icon slot="start" name="${error ? "alert-circle-outline" : "cloud-done-outline"}" color="${error ? "danger" : "primary"}"></ion-icon>
    <ion-label class="ion-text-wrap">${esc(text)}</ion-label>
  </ion-item>`;
}

// Whether <site> (a widget's arg) is another site than this one.
const isElsewhere = (arg) => !!arg && new URL(arg, location.href).origin !== location.origin;

export function dataWidget({ exportData, importData }) {
  return (el, arg) => {
    el.innerHTML = `<ion-list inset>${isElsewhere(arg)
      ? item("export", "archive-outline", "Export Data…", { last: true })
      : item("import", "download-outline", "Import Data…", { last: true })}</ion-list>`;
    el.addEventListener("click", (e) => {
      const action = e.target.closest("[data-sync-action]")?.dataset.syncAction;
      if (action === "export") exportData();
      else if (action === "import") importData();
    });
  };
}

export function syncWidget(sync, sheet) {
  return (el, arg) => {
    if (!sync.configured || !sheet) return el.remove();
    const site = arg ? new URL(arg, location.href) : null;
    const elsewhere = isElsewhere(arg);

    const render = () => {
      let items;
      if (!elsewhere) {
        items = sync.hasKey ? statusRow(sync) : item("join", "key-outline", "Use a Key from Another Device…", { last: true });
      } else if (!sync.hasKey) {
        items = item("on", "cloud-upload-outline", "Turn On Sync", { last: true });
      } else if (!sync.enabled) {
        items = item("resume", "cloud-upload-outline", "Turn Sync Back On", { last: true });
      } else {
        items = `${statusRow(sync)}
          <ion-item><ion-label class="sync-key">${esc(sync.key)}</ion-label></ion-item>
          ${item("copy", "copy-outline", "Copy Key")}
          ${item("continue", "open-outline", `Continue on ${esc(site.host)}`, { disabled: sync.status !== "synced", last: true })}`;
      }
      el.innerHTML = `<ion-list inset>${items}</ion-list>`;
    };

    const onClick = async (e) => {
      const action = e.target.closest("[data-sync-action]")?.dataset.syncAction;
      try {
        switch (action) {
          case "on": return await sync.turnOn();
          case "resume": return await sync.resume();
          case "join": return await sheet.promptJoin();
          case "copy":
            await navigator.clipboard.writeText(sync.key);
            return toast("Sync key copied");
          case "continue":
            await sync.syncNow();   // the latest changes first
            if (sync.status === "synced") location.assign(new URL(`#/sync/${sync.key}`, site).href);
        }
      } catch (err) {
        toast(err.message, { color: "danger" });
      }
    };

    el.addEventListener("click", onClick);
    sync.addEventListener("status", render);
    render();
    return () => sync.removeEventListener("status", render);
  };
}
