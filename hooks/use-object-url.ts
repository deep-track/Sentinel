"use client";

import { useEffect, useState } from "react";

/**
 * Creates a `blob:` URL for previewing a local file and revokes it when the
 * file changes or the component unmounts. The URL is for on-screen preview
 * only — never persist it, it dies with the tab.
 */
export function useObjectUrl(file: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  return url;
}
