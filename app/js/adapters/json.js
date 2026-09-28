// JSON adapter: a static snapshot file already in the app's model shape
// ({searches, listings, sources}). Read-only upstream, so edits stay on this
// device. Good for demos, a public read-only mirror, or trying the app with
// no account.
export const FIELDS_FOR_SETTINGS = [
  { key: "url", label: "Snapshot URL", placeholder: "demo/west-side-1br.json", required: true },
];

export function create(config) {
  const url = config.url || "demo/west-side-1br.json";
  return {
    kind: "json",
    describe() {
      return { kind: "JSON snapshot", name: url.split("/").pop(), detail: url, writable: false, url };
    },
    async pull() {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("Couldn't load " + url + " (HTTP " + res.status + ")");
      const j = await res.json();
      return { searches: j.searches || [], listings: j.listings || [], sources: j.sources || [] };
    },
    async pushListing() {
      const err = new Error("This snapshot is read-only; the change is saved on this device only.");
      err.readOnly = true;
      throw err;
    },
  };
}
