import type { Metadata } from "next";
import { Suspense } from "react";

import { ClaimPage } from "@/components/ClaimPage";

export const metadata: Metadata = { title: "Claim · Heir" };

export default function Claim() {
  // ClaimPage reads ?owner= from the URL, which is only known in the browser.
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ClaimPage />
      </Suspense>
    </div>
  );
}
