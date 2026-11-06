import type { Metadata } from "next";

import { OwnerDashboard } from "@/components/OwnerDashboard";

export const metadata: Metadata = { title: "My vault · Heir" };

export default function VaultPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <OwnerDashboard />
    </div>
  );
}
