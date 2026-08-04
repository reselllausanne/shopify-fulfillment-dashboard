import { Suspense } from "react";
import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import ReturnsEmbedBootstrap from "@/app/returns/EmbedBootstrap";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Demande de retour",
  description: "Demandez un retour pour votre commande",
  robots: { index: false, follow: false },
};

export default function ReturnsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={instrumentSans.className} data-returns-portal="">
      <Suspense fallback={null}>
        <ReturnsEmbedBootstrap />
      </Suspense>
      {children}
    </div>
  );
}
