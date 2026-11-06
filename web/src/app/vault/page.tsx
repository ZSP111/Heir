import type { Metadata } from "next";

import { OwnerDashboard } from "@/components/OwnerDashboard";

export const metadata: Metadata = { title: "My vault · Heir" };

export default function VaultPage() {
  return <OwnerDashboard />;
}
