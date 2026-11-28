"use client";

import type { ReactNode } from "react";
import Shell from "./_components/Shell";
import { WarehouseProvider } from "./_lib/context";

export default function WarehouseLayout({ children }: { children: ReactNode }) {
  return (
    <WarehouseProvider>
      <Shell>{children}</Shell>
    </WarehouseProvider>
  );
}
