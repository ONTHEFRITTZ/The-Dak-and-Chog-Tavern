'use client';

import { useEffect, useState } from "react";

type BuildInfo = {
  version?: string;
  commit?: string;
  builtAt?: string;
};

export function FooterMeta() {
  const [meta, setMeta] = useState<BuildInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [versionTxt, buildJson] = await Promise.all([
          fetch("/assets/version.txt", { cache: "no-store" })
            .then((res) => (res.ok ? res.text() : null))
            .catch(() => null),
          fetch("/assets/build.json", { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null),
        ]);
        if (!mounted) return;
        setMeta({
          version: versionTxt ? versionTxt.trim() : undefined,
          commit: buildJson?.commit ? String(buildJson.commit).slice(0, 12) : undefined,
          builtAt: buildJson?.builtAt,
        });
        setError(null);
      } catch (err) {
        if (!mounted) return;
        setError("Version info unavailable");
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const label = meta
    ? `Version: ${meta.version ?? "n/a"} | Commit: ${meta.commit ?? "unknown"} | Built: ${
        meta.builtAt ?? "unknown"
      }`
    : error ?? "Loading build info...";

  return (
    <div className="footer-meta-container">
      <div className="footer-meta">{label}</div>
    </div>
  );
}
